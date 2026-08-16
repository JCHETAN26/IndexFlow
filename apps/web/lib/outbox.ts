import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aclTokens } from "@/lib/acl";
import {
  CHUNK_INDEX,
  deleteDocumentChunks,
  ensureChunkIndex,
  getProjectionState,
  indexChunks,
  type EsChunk,
} from "@/lib/es";

/**
 * Transactional outbox + Elasticsearch projector (IF-1).
 *
 * Postgres is the source of truth. Elasticsearch is a projection of it, and the only safe way to
 * keep a projection honest is to make "the state changed" and "the projection owes an update"
 * commit together. So every mutation writes an outbox row inside its own transaction, and this
 * module drains those rows.
 *
 * The design decision that makes retries and races safe: an outbox event carries NO PAYLOAD. It
 * is a bare signal that says "document X needs projecting". The projector re-reads the document's
 * current chunks and current ACL at projection time. Consequences:
 *
 *   - Retrying is free and idempotent — a replay just re-projects current truth.
 *   - A revoke that lands mid-index cannot be lost. The old code embedded for several seconds
 *     and then wrote an ACL snapshot taken before that work started, clobbering any revoke in
 *     between. Here the ACL is read after the content is settled, so the projection reflects the
 *     revoke. This is the "reapply ACL during final hydration" requirement, and it is a security
 *     property, not a tidiness one.
 *   - Out-of-order projections are rejected by the version guard below rather than corrupting
 *     state.
 *
 * Delivery is at-least-once, and convergence is guaranteed by `reconcile()` for anything the
 * inline and background drains both miss.
 */

/** Reasons are free text, for operator legibility when inspecting the table. */
export type OutboxReason =
  | "ingest:content"
  | "acl:change"
  | "document:delete"
  | "reconcile:drift"
  | (string & {});

/**
 * Record that a document's projection is owed. MUST be called with the transaction client of the
 * mutation it accompanies — passing the global client would reintroduce the very gap this exists
 * to close.
 */
export async function enqueueProjection(
  tx: Prisma.TransactionClient,
  documentId: string,
  reason: OutboxReason,
): Promise<void> {
  await tx.outboxEvent.create({ data: { documentId, reason } });
}

/** Bump a document's ACL version and queue its projection, atomically. */
export async function bumpAclVersion(
  tx: Prisma.TransactionClient,
  documentId: string,
  reason: OutboxReason = "acl:change",
): Promise<void> {
  await tx.document.update({
    where: { id: documentId },
    data: { aclVersion: { increment: 1 } },
  });
  await enqueueProjection(tx, documentId, reason);
}

/**
 * How a projection publishes its writes to Elasticsearch.
 *
 * `wait_for` blocks until the next *scheduled* refresh. With `index.refresh_interval` at its 1 s
 * default that is a hard floor of up to a second on every projection, and it showed up as a p50 of
 * 1020–1055 ms per document at *every* concurrency level — the refresh clock, not the pipeline's
 * work. `true` performs the refresh immediately instead of waiting for that clock.
 *
 * Elasticsearch's guidance prefers `wait_for`, on the grounds that forcing a refresh per request
 * makes many tiny segments and the merge pressure that follows. Measured here, the trade is
 * lopsided: ingestion went from 0.99 to 11.81 docs/s per worker (p50 1020 → 82 ms) while the index
 * stayed at 6 segments, and the counters showed the refresh *count* was never the cost — waiting
 * for it was. See docs/remediation/ingestion-benchmark.md.
 *
 * This does not weaken the guarantee the refresh is there to provide. `true` is the stronger of the
 * two: the write is visible when the call returns, rather than at the next tick. A document still
 * becomes INDEXED only once the keyword index demonstrably holds it.
 *
 * The segment cost of one forced refresh per document is NOT measured beyond 40-document runs. Set
 * `PROJECTION_REFRESH=wait_for` to revert if a large bulk load shows merge pressure.
 */
const PROJECTION_REFRESH: "wait_for" | true =
  process.env.PROJECTION_REFRESH === "wait_for" ? "wait_for" : true;

export interface ProjectionOutcome {
  documentId: string;
  action: "indexed" | "deleted" | "skipped-stale" | "noop";
  chunkCount: number;
}

/**
 * Bring Elasticsearch in line with Postgres for one document.
 *
 * Reads current state, compares against what ES already holds, and writes the whole document's
 * chunks if ours is not older. Safe to call concurrently: the loser of a race writes a snapshot
 * that the version guard rejects, or writes an equivalent one.
 */
export async function projectDocument(
  documentId: string,
  index: string = CHUNK_INDEX,
): Promise<ProjectionOutcome> {
  await ensureChunkIndex(index);
  return prisma.$transaction(
    (tx) => projectWithinLock(tx, documentId, index),
    // Generous: the body performs Elasticsearch I/O with refresh=wait_for while holding the
    // lock. Serialising per document is worth a held connection for a second or two.
    { timeout: 120_000, maxWait: 60_000 },
  );
}

/**
 * The projection body, run while holding a per-document advisory lock.
 *
 * The lock is what makes the version guard sound. Comparing versions on its own is a
 * time-of-check/time-of-use bug: two concurrent projections can both read, both decide they are
 * current, and then write in the wrong order — letting the one built on a pre-revoke snapshot
 * land last and reinstate access. Measured at roughly one in four runs before this lock existed.
 */
async function projectWithinLock(
  tx: Prisma.TransactionClient,
  documentId: string,
  index: string,
): Promise<ProjectionOutcome> {
  // Transaction-scoped, so it is released on commit or rollback without any cleanup path.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentId}::text, 0))`;

  // One consistent read of everything the projection depends on, taken under the lock.
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: {
      title: true,
      fileType: true,
      isPublic: true,
      ownerId: true,
      status: true,
      aclVersion: true,
      contentVersion: true,
      grants: { select: { userId: true, groupId: true } },
      chunks: {
        select: { id: true, chunkIndex: true, content: true },
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  // Deleted in Postgres → remove the projection. This is why outbox rows have no FK.
  if (!doc) {
    await deleteDocumentChunks(documentId, index, true);
    return { documentId, action: "deleted", chunkCount: 0 };
  }

  const current = await getProjectionState(documentId, index);
  // Strictly-newer wins. Equal versions still project, because ES may be missing chunks
  // entirely at the same version (exactly the "falsely ready" failure).
  const esIsNewer =
    current.contentVersion > doc.contentVersion || current.aclVersion > doc.aclVersion;
  if (esIsNewer) {
    return { documentId, action: "skipped-stale", chunkCount: current.chunkCount };
  }

  if (doc.chunks.length === 0) {
    // Nothing to project yet (uploaded but not ingested), but any stale chunks must go.
    if (current.chunkCount > 0) await deleteDocumentChunks(documentId, index, true);
    return { documentId, action: "noop", chunkCount: 0 };
  }

  // The ACL is read HERE, after the content is settled — not captured before a slow embed.
  const acl = aclTokens(doc);
  const esChunks: EsChunk[] = doc.chunks.map((c) => ({
    chunkId: c.id,
    documentId,
    chunkIndex: c.chunkIndex,
    title: doc.title,
    fileType: doc.fileType,
    content: c.content,
    acl,
    aclVersion: doc.aclVersion,
    contentVersion: doc.contentVersion,
  }));

  // Replace wholesale: drop anything ES holds for this document, then write the current set.
  // Chunk ids are stable per ingest, so a re-index that produced fewer chunks cannot leave
  // orphans behind.
  //
  // The delete does not force a refresh of its own — the index call that follows publishes both
  // together, so a reader never sees one without the other. Forcing one here as well used to reset
  // the refresh clock, which is what made the `wait_for` below then block for a full interval.
  await deleteDocumentChunks(documentId, index, false);
  await indexChunks(esChunks, index, PROJECTION_REFRESH);

  // The document is only INDEXED once the keyword leg actually has it. This is the state
  // transition the old code got wrong: it set INDEXED inside the Postgres transaction, before
  // the mirror was even attempted.
  if (doc.status === "INDEXING" || doc.status === "UPLOADED") {
    await tx.document.update({
      where: { id: documentId },
      data: { status: "INDEXED", indexedAt: new Date() },
    });
  }

  return { documentId, action: "indexed", chunkCount: esChunks.length };
}

const MAX_ATTEMPTS = 5;

/**
 * Process pending outbox rows, oldest first.
 *
 * Rows are claimed with SKIP LOCKED so several drainers (web process, worker, a manual run) can
 * work the same table without doing each other's work twice.
 */
export async function drainOutbox(limit = 50): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (;;) {
    const claimed = await prisma.$queryRaw<{ id: string; document_id: string; attempts: number }[]>`
      UPDATE outbox_events
      SET status = 'DONE', processed_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status = 'PENDING'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.min(limit, 20)}
      )
      RETURNING id, document_id, attempts
    `;
    if (claimed.length === 0) break;

    for (const row of claimed) {
      try {
        await projectDocument(row.document_id);
        processed++;
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        // Put it back for another attempt, unless it has exhausted them — in which case leave it
        // FAILED and visible. reconcile() is the backstop that will re-queue genuine drift.
        await prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: row.attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            processedAt: null,
            lastError: message.slice(0, 1000),
          },
        });
        console.error(`[outbox] projection failed for ${row.document_id}: ${message}`);
      }
    }
    if (claimed.length < Math.min(limit, 20)) break;
    if (processed + failed >= limit) break;
  }

  return { processed, failed };
}

/**
 * Best-effort inline projection, for the request that caused the change.
 *
 * The outbox alone is eventually consistent, but users expect sharing a document to take effect
 * immediately. So callers project inline and let the durable path cover them if it throws — the
 * event is already committed, so a failure here only delays the update, never loses it.
 */
export async function projectNow(documentId: string): Promise<void> {
  try {
    await projectDocument(documentId);
    await prisma.outboxEvent.updateMany({
      where: { documentId, status: "PENDING" },
      data: { status: "DONE", processedAt: new Date() },
    });
  } catch (e) {
    console.error(
      `[outbox] inline projection for ${documentId} failed, leaving it to the drainer:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Reconciliation: find documents whose projection disagrees with Postgres and queue a repair.
 *
 * The outbox guarantees an update is *owed*, not that it ever succeeded — a row can exhaust its
 * attempts, and an operator can always mutate Elasticsearch out from under us. This is the sweep
 * that closes that gap, and the answer to "how would you know if the two stores drifted?".
 */
export async function reconcile(limit = 500): Promise<{ checked: number; repaired: string[] }> {
  const docs = await prisma.document.findMany({
    where: { status: { in: ["INDEXED", "INDEXING"] } },
    select: {
      id: true,
      aclVersion: true,
      contentVersion: true,
      _count: { select: { chunks: true } },
    },
    take: limit,
    orderBy: { uploadedAt: "desc" },
  });

  const repaired: string[] = [];
  for (const d of docs) {
    const es = await getProjectionState(d.id);
    // Versions only mean something when there are chunks carrying them. A document with no
    // chunks on either side is consistent — comparing versions there would flag it as drifted
    // on every single pass, and each "repair" would be a no-op that flags it again.
    const drifted =
      es.chunkCount !== d._count.chunks ||
      (d._count.chunks > 0 &&
        (es.aclVersion !== d.aclVersion || es.contentVersion !== d.contentVersion));
    if (!drifted) continue;

    repaired.push(d.id);
    await prisma.outboxEvent.create({ data: { documentId: d.id, reason: "reconcile:drift" } });
    console.warn(
      `[reconcile] drift on ${d.id}: pg(chunks=${d._count.chunks} acl=v${d.aclVersion} content=v${d.contentVersion}) ` +
        `es(chunks=${es.chunkCount} acl=v${es.aclVersion} content=v${es.contentVersion})`,
    );
  }

  return { checked: docs.length, repaired };
}
