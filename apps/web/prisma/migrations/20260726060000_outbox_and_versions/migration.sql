-- Cross-store reliability (IF-1).
--
-- Postgres is the source of truth; Elasticsearch is a projection of it. Previously the ES write
-- happened after the Postgres transaction committed, with no record that it was owed and no way
-- to tell a stale write from a fresh one. Two consequences, both reproduced by
-- eval/consistency-check.ts before this migration:
--   * a revoke landing while a re-index was in flight was overwritten by the re-index's stale
--     ACL snapshot, leaving a revoked principal able to reach the document via keyword search;
--   * a failed ES mirror left the document reading as INDEXED with nothing in the keyword index.

-- Monotonic versions. content_version changes when a document's chunks are rewritten;
-- acl_version changes when its visibility does. They let the projector recognise and discard a
-- write built from a snapshot older than what Elasticsearch already holds.
ALTER TABLE "documents" ADD COLUMN "acl_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "documents" ADD COLUMN "content_version" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- Transactional outbox: a row here is written in the SAME transaction as the state change it
-- describes, so "Postgres committed" and "Elasticsearch owes an update" can never disagree. The
-- projector drains it and is free to retry, because it re-reads current state rather than
-- replaying a payload.
--
-- Deliberately NO foreign key to documents: a deletion event must outlive the row it refers to.
CREATE TABLE "outbox_events" (
    "id"           UUID NOT NULL,
    "document_id"  UUID NOT NULL,
    "reason"       TEXT NOT NULL,
    "status"       "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"     INTEGER NOT NULL DEFAULT 0,
    "last_error"   TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- The drain query: oldest pending first.
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events" ("status", "created_at");
CREATE INDEX "outbox_events_document_id_idx" ON "outbox_events" ("document_id");

-- Everything already indexed predates versioning. Bump both versions off zero so the first
-- projection after this migration is recognised as newer than whatever ES currently holds
-- (which carries no version at all, and is read as -1).
UPDATE "documents" SET "acl_version" = 1, "content_version" = 1;

-- Queue a reconciliation pass for every already-indexed document, so their ES chunks pick up
-- the version fields without needing a manual backfill.
INSERT INTO "outbox_events" ("id", "document_id", "reason")
SELECT gen_random_uuid(), "id", 'migration:backfill-versions'
FROM "documents"
WHERE "status" = 'INDEXED';
