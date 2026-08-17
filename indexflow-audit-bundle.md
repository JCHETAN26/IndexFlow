# IndexFlow — self-contained review bundle

Generated for external audit. Contains the repository's load-bearing source verbatim, an
inventory of everything else, a code-vs-docs consistency check, and a gap list.

- **Generated:** 2026-08-12 23:38:16 MST
- **Repository:** IndexFlow (permission-aware hybrid document search with grounded answers)
- **Bundle scope:** all first-party source. `node_modules`, `.next`, `dist`, `.git`, and
  `.evalrun` are excluded throughout.

> **Reading note.** Section 2 is verbatim source, fenced with four backticks so that any
> three-backtick runs inside the files survive intact. Section 4 lists discrepancies without
> resolving them, as requested.

---

## 1. Repo overview

### Commit and branch

| | |
|---|---|
| `git log -1 --format='%H %ad'` | `8d5906aa59d85fe769cb04075ce5676113a18db2 Wed Aug 12 21:52:27 2026 -0700` |
| Current branch | `eval/phase1-instrument-verification` |
| Total commits (`git rev-list --count HEAD`) | 77 |
| Working tree at generation time | 2 uncommitted path(s) |

Uncommitted paths at generation time:

```
?? indexflow-audit-bundle.md
?? report.md
```

### Lines of code by directory

`cloc` is **not installed** on this machine, so the following is a `find` + `wc -l` breakdown
of `.ts`/`.tsx` under `apps/` and `infra/`, excluding `node_modules`, `.next`, and `dist`.

| Directory | Lines | Files |
|---|---:|---:|
| `apps/web/eval` | 5259 | 21 |
| `apps/web/lib` | 2244 | 20 |
| `apps/web/test/unit` | 700 | 5 |
| `apps/web/bench` | 628 | 2 |
| `apps/web/app` | 505 | 2 |
| `apps/web/app/documents` | 412 | 1 |
| `apps/web/scripts` | 382 | 7 |
| `apps/web/test/integration` | 376 | 1 |
| `apps/web/app/eval` | 346 | 1 |
| `apps/web/app/groups` | 229 | 1 |
| `apps/web` | 207 | 8 |
| `apps/web/e2e` | 201 | 4 |
| `apps/web/app/api/answer` | 138 | 1 |
| `apps/web/app/upload` | 134 | 1 |
| `apps/web/app/jobs` | 131 | 1 |
| `apps/web/app/api/search` | 122 | 1 |
| `apps/web/app/api/documents/upload` | 122 | 1 |
| `apps/web/app/api/jobs/[id]` | 116 | 1 |
| `apps/web/app/api/groups/[id]/members` | 110 | 1 |
| `apps/web/worker` | 97 | 1 |
| `apps/web/app/api/documents/[id]/history` | 91 | 1 |
| `apps/web/app/api/groups` | 86 | 1 |
| `apps/web/app/api/eval/rag` | 80 | 1 |
| `apps/web/app/api/documents/[id]/sharing` | 77 | 1 |
| `apps/web/app/api/chunks/[id]` | 76 | 1 |
| `apps/web/app/api/documents` | 66 | 1 |
| `apps/web/app/api/documents/[id]` | 66 | 1 |
| `apps/web/app/api/eval` | 65 | 1 |
| `apps/web/app/signin` | 64 | 1 |
| `apps/web/app/api/jobs` | 60 | 1 |
| `apps/web/app/api/documents/[id]/file` | 51 | 1 |
| `apps/web/test` | 32 | 1 |
| `apps/web/app/api/health` | 32 | 1 |
| `apps/web/app/api/ops/usage` | 14 | 1 |
| `apps/web/types` | 10 | 1 |
| `apps/web/app/api/auth/[...nextauth]` | 4 | 1 |
| **Total .ts/.tsx** | **13333** | **97** |

### Totals by file type (whole repo, excluding vendored and lockfiles)

| Extension | Files | Lines |
|---|---:|---:|
| `.ts` | 89 | 11512 |
| `.tsx` | 8 | 1821 |
| `.prisma` | 1 | 246 |
| `.yml` | 4 | 808 |
| `.sql` | 10 | 327 |
| `.md` | 20 | 5531 |
| `.json` | 13 | 3654 |
| `.py` | 1 | 137 |

### File tree — `apps/web`, depth 3

`tree` is not installed; this is `find -maxdepth 3` with `node_modules`, `.next`, `dist`, and
`.evalrun` pruned.

```
apps/web
.env
.env.example
app
  api
    answer
    auth
    chunks
    documents
    eval
    groups
    health
    jobs
    ops
    search
  documents
    page.tsx
  eval
    page.tsx
  globals.css
  groups
    page.tsx
  jobs
    page.tsx
  layout.tsx
  page.tsx
  signin
    page.tsx
  upload
    page.tsx
auth.config.ts
auth.ts
bench
  ingest-bench.ts
  latency-bench.ts
e2e
  fixtures.ts
  global-setup.ts
  global-teardown.ts
  principal-workflow.spec.ts
eval
  RESULTS.md
  acl-leak.ts
  adversarial-run.ts
  answers.json
  beir.ts
  calibrate-judges.ts
  consistency-check.ts
  corpus.json
  crosscheck.py
  dao-check.ts
  dataset.ts
  depth-matrix.ts
  embed-shard.ts
  export-labels.ts
  harness.ts
  improvements&adjustments.md
  label-audit.ts
  metrics.ts
  queries.json
  rag-harness.ts
  rag-run.ts
  run.ts
  scale-curve.ts
  scale-dataset.ts
  scale-run.ts
  sharing-check.ts
  trec-export.ts
instrumentation.node.ts
instrumentation.ts
lib
  acl.ts
  chunk.ts
  demo.ts
  embed.ts
  es.ts
  extract.ts
  groups.ts
  hybrid.ts
  ingest.ts
  llm.ts
  outbox.ts
  prisma.ts
  queue.ts
  rag.ts
  ratelimit.ts
  rerank.ts
  retrieve.ts
  sharing.ts
  storage.ts
  usage.ts
middleware.ts
next-env.d.ts
next.config.mjs
package.json
playwright.config.ts
postcss.config.mjs
prisma
  migrations
    20260629234538_init
    20260629234600_fts_gin_index
    20260630001328_add_embeddings
    20260701042709_add_storage_key
    20260701045729_ingestion_jobs
    20260708201014_identity_authjs
    20260717221922_permission_aware_acl
    20260726020000_grant_exactly_one_principal
    20260726060000_outbox_and_versions
    20260727010000_group_owner
    migration_lock.toml
  schema.prisma
scripts
  backfill-embeddings.ts
  backfill-es.ts
  outbox-drain.ts
  reconcile.ts
  retention-cleanup.ts
  seed.ts
  smoke.ts
seed
  corpus
    api-error-codes.txt
    deployment-runbook.txt
    mobile-editor-performance.pdf
    onboarding-guide.md
    product-spec-search.md
    q2-infrastructure-review.pdf
    security-runbook.md
    standup-notes-2026-06.md
test
  integration
    security-regression.test.ts
  setup-env.ts
  unit
    acl.test.ts
    hybrid.test.ts
    metrics.test.ts
    ratelimit.test.ts
    rerank.test.ts
tsconfig.json
tsconfig.tsbuildinfo
types
  next-auth.d.ts
vitest.config.ts
worker
  index.ts
```

---

## 2. Full source, verbatim

Every file below is reproduced complete and unmodified. One requested path does not exist as
given — see the note immediately below.

> **Path correction.** The request listed `prisma/schema.prisma`. **There is no
> `prisma/schema.prisma` at the repository root.** The Prisma schema lives at
> **`apps/web/prisma/schema.prisma`** (declared via the `prisma.schema` key in
> `apps/web/package.json`). That file is reproduced below under its real path. No substitution
> was made for any other requested path; all others exist exactly as listed.

### 2.1 Database schema

### `apps/web/prisma/schema.prisma`

_246 lines_

````prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// ── Identity (Auth.js / NextAuth with the Prisma adapter) ──────────────────
// Stage A: sign-in + users. The Account table also stores per-provider OAuth
// tokens (access/refresh), which Stage C reuses to call the Google Drive API on
// the user's behalf. Field names are the adapter's contract; @map keeps the DB
// snake_case like the rest of the schema.

model User {
  id            String    @id @default(uuid()) @db.Uuid
  name          String?
  email         String?   @unique
  emailVerified DateTime? @map("email_verified")
  image         String?
  createdAt     DateTime  @default(now()) @map("created_at")

  accounts Account[]
  sessions Session[]

  // ── Permissions (Stage: permission-aware search) ──
  ownedDocuments   Document[]      @relation("DocumentOwner")
  ownedGroups      Group[]         @relation("GroupOwner")
  groupMemberships GroupMember[]
  documentGrants   DocumentGrant[]

  @@map("users")
}

model Account {
  id                String  @id @default(uuid()) @db.Uuid
  userId            String  @map("user_id") @db.Uuid
  type              String
  provider          String
  providerAccountId String  @map("provider_account_id")
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(uuid()) @db.Uuid
  sessionToken String   @unique @map("session_token")
  userId       String   @map("user_id") @db.Uuid
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

enum DocumentStatus {
  UPLOADED
  INDEXING
  INDEXED
  FAILED
}

enum OutboxStatus {
  PENDING
  DONE
  FAILED
}

/// Transactional outbox. A row is written in the SAME Postgres transaction as the state change
/// it describes, so "Postgres committed" and "Elasticsearch owes an update" cannot disagree.
/// The projector (lib/outbox.ts) drains it by re-reading current state, never by replaying a
/// stored payload — which is what makes retries safe and stale writes impossible.
///
/// Intentionally has no relation to Document: a deletion event must outlive its document.
model OutboxEvent {
  id          String       @id @default(uuid()) @db.Uuid
  documentId  String       @map("document_id") @db.Uuid
  reason      String
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  lastError   String?      @map("last_error")
  createdAt   DateTime     @default(now()) @map("created_at")
  processedAt DateTime?    @map("processed_at")

  @@index([status, createdAt])
  @@index([documentId])
  @@map("outbox_events")
}

enum JobStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
}

model Document {
  id         String         @id @default(uuid()) @db.Uuid
  title      String
  fileName   String
  fileType   String
  storageKey String? // MinIO object key for the original file
  status     DocumentStatus @default(UPLOADED)
  uploadedAt DateTime       @default(now())
  indexedAt  DateTime?

  // ── Permissions ──
  // A document is visible to a viewer if it is public, they own it, or a grant
  // targets them (directly, or a group they belong to). `isPublic` defaults to
  // false (restrictive): a new upload is private to its owner until shared. The
  // ACL is denormalised into each Elasticsearch chunk (an `acl` principal list)
  // so keyword search filters at the index; Postgres enforces the same rule via
  // joins on the tables below (see lib/acl.ts, lib/retrieve.ts).
  ownerId  String?  @map("owner_id") @db.Uuid
  isPublic Boolean  @default(false) @map("is_public")

  // Monotonic projection versions (see lib/outbox.ts). `contentVersion` changes when the
  // document's chunks are rewritten, `aclVersion` when its visibility changes. Both are
  // mirrored onto the Elasticsearch chunks so the projector can discard a write built from a
  // snapshot older than what ES already holds.
  aclVersion     Int @default(0) @map("acl_version")
  contentVersion Int @default(0) @map("content_version")

  owner  User?           @relation("DocumentOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  grants DocumentGrant[]

  chunks DocumentChunk[]
  jobs   IngestionJob[]

  @@index([ownerId])
  @@map("documents")
}

// A user or a group to which visibility of a set of resources is granted.
/// A group of users that documents can be shared with.
///
/// `ownerId` is who may change the membership. It is nullable because groups created before the
/// column existed have no owner, and the application treats those as unmanageable rather than
/// guessing: an ownerless group fails closed, so nobody can add themselves to it. Without an owner
/// there is nothing to authorize against, and membership becomes self-service — which is exactly
/// how a signed-in user could grant themselves access to every document shared with a group.
model Group {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at")
  ownerId   String?  @map("owner_id") @db.Uuid

  owner   User?           @relation("GroupOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  members GroupMember[]
  grants  DocumentGrant[]

  @@index([ownerId])
  @@map("groups")
}

model GroupMember {
  userId  String @map("user_id") @db.Uuid
  groupId String @map("group_id") @db.Uuid

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@id([userId, groupId])
  @@index([groupId])
  @@map("group_members")
}

// One access grant on a document to exactly one principal — either a user
// (`userId`) or a group (`groupId`). Ownership and `isPublic` are handled on the
// Document itself; this table holds explicit shares beyond those.
// A grant targets exactly one principal — a user OR a group. Prisma cannot express that, so it
// is enforced by the CHECK constraint `document_grants_exactly_one_principal` (migration
// 20260726020000). Both-null grants nothing; both-set silently widens access in lib/acl aclTokens.
model DocumentGrant {
  id         String  @id @default(uuid()) @db.Uuid
  documentId String  @map("document_id") @db.Uuid
  userId     String? @map("user_id") @db.Uuid
  groupId    String? @map("group_id") @db.Uuid

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user     User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  group    Group?   @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([documentId, userId, groupId])
  @@index([documentId])
  @@index([userId])
  @@index([groupId])
  @@map("document_grants")
}

model IngestionJob {
  id          String    @id @default(uuid()) @db.Uuid
  documentId  String    @db.Uuid
  status      JobStatus @default(QUEUED)
  error       String?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("ingestion_jobs")
}

model DocumentChunk {
  id         String   @id @default(uuid()) @db.Uuid
  documentId String   @db.Uuid
  chunkIndex Int
  content    String
  tokenCount Int
  createdAt  DateTime @default(now())

  // 384-dim embedding from all-MiniLM-L6-v2. Written/queried via raw SQL (pgvector).
  embedding Unsupported("vector(384)")?

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, chunkIndex])
  @@index([documentId])
  @@map("document_chunks")
}
````

### 2.2 Library modules

### `apps/web/lib/retrieve.ts`

_219 lines_

````ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { embedOne, toVectorLiteral } from "@/lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "@/lib/hybrid";
import { keywordSearch } from "@/lib/es";
import type { Viewer } from "@/lib/acl";
import { trace } from "@opentelemetry/api";
import { rerank, type RerankCandidate } from "./rerank";

const tracer = trace.getTracer("indexflow-web");

/**
 * Shared retrieval used by both the search route (app/api/search) and the RAG
 * answer path (lib/rag). Keeping the keyword + semantic candidate fetchers and the
 * hybrid blend in one place means search results and the chunks fed to the LLM come
 * from the exact same ranking — `blendHybrid` / `DEFAULT_HYBRID_WEIGHT` (lib/hybrid)
 * stay the single source of truth for the blend.
 *
 * Both legs are permission-aware: every entry point requires a `viewer` so a caller
 * can't retrieve chunks the viewer can't see. Keyword filters index-side in
 * Elasticsearch (a `terms` filter on the chunk's denormalised ACL); semantic filters
 * with the SQL predicate below. The two encode the same rule (see lib/acl).
 */

export const CANDIDATE_LIMIT = 30;

/**
 * SQL predicate (over `documents d`) that is true iff the document is visible to the
 * viewer: public, owned by them, or granted to them directly or via a group. When
 * `userId` is null (anonymous) every clause but `is_public` is false, so they see only
 * public documents. Mirrors the ES `terms` filter on the same principals.
 */
function visibleToViewer(viewer: Viewer): Prisma.Sql {
  const uid = viewer.userId;
  return Prisma.sql`(
    d.is_public
    OR (${uid}::uuid IS NOT NULL AND d.owner_id = ${uid}::uuid)
    OR EXISTS (SELECT 1 FROM document_grants g WHERE g.document_id = d.id AND g.user_id = ${uid}::uuid)
    OR EXISTS (
      SELECT 1 FROM document_grants g
      JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = ${uid}::uuid
      WHERE g.document_id = d.id
    )
  )`;
}

export interface Candidate {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string; // keyword: ES highlight w/ sentinels; semantic: raw content prefix
  score: number; // keyword: BM25; semantic: cosine similarity
}

// Keyword search runs on Elasticsearch (BM25 + highlighting). The sentinel-delimited
// snippet is HTML-escaped then re-marked by the caller (XSS-safe).
export async function fetchKeyword(
  q: string,
  fileType: string | null,
  viewer: Viewer,
  limit: number = CANDIDATE_LIMIT,
): Promise<Candidate[]> {
  return tracer.startActiveSpan("fetchKeyword", async (span) => {
    try {
      const hits = await keywordSearch(q, fileType, limit, undefined, viewer.principals);
      const candidates = hits.map((h) => ({
        chunkId: h.chunkId,
        documentId: h.documentId,
        title: h.title,
        fileType: h.fileType,
        snippet: h.snippet,
        score: h.score,
      }));
      span.setAttribute("hits", candidates.length);
      return candidates;
    } finally {
      span.end();
    }
  });
}

export async function fetchSemantic(
  q: string,
  fileType: string | null,
  viewer: Viewer,
  limit: number = CANDIDATE_LIMIT,
): Promise<Candidate[]> {
  return tracer.startActiveSpan("fetchSemantic", async (span) => {
    try {
      const vec = toVectorLiteral(await embedOne(q));
      const candidates = await prisma.$queryRaw<Candidate[]>`
        SELECT
          dc.id::text                          AS "chunkId",
          dc."documentId"::text                AS "documentId",
          d.title                              AS title,
          d."fileType"                         AS "fileType",
          left(dc.content, 320)                AS snippet,
          1 - (dc.embedding <=> ${vec}::vector) AS score
        FROM document_chunks dc
        JOIN documents d ON d.id = dc."documentId"
        WHERE dc.embedding IS NOT NULL
          AND (${fileType}::text IS NULL OR d."fileType" = ${fileType})
          AND ${visibleToViewer(viewer)}
        ORDER BY dc.embedding <=> ${vec}::vector
        LIMIT ${limit}
      `;
      span.setAttribute("hits", candidates.length);
      return candidates;
    } finally {
      span.end();
    }
  });
}

export const toScored = (c: Candidate[]): Scored[] =>
  c.map((x) => ({ id: x.chunkId, score: x.score }));

/**
 * A full-content chunk chosen for grounding an LLM answer. Unlike search results
 * (which carry a 160/320-char highlighted snippet), the generator needs the whole
 * chunk, so `content` is fetched fresh from Postgres.
 */
export interface RetrievedContext {
  marker: number; // 1-based citation index the model cites as [n]
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  content: string;
}

/**
 * Top-k hybrid retrieval for RAG. Runs the same keyword + semantic + blend as search,
 * then hydrates the winning chunk ids with their full content from Postgres, preserving
 * blended rank order.
 */
export async function retrieveContexts(
  query: string,
  k: number,
  viewer: Viewer,
  fileType: string | null = null,
  useReranker: boolean = false,
): Promise<RetrievedContext[]> {
  return tracer.startActiveSpan("retrieveContexts", async (span) => {
    try {
      span.setAttribute("query", query);
      span.setAttribute("k", k);
      span.setAttribute("useReranker", useReranker);

      const [keyword, semantic] = await Promise.all([
        fetchKeyword(query, fileType, viewer),
        fetchSemantic(query, fileType, viewer),
      ]);
      let blended = blendHybrid(toScored(keyword), toScored(semantic), DEFAULT_HYBRID_WEIGHT);
      
      if (useReranker) {
        const topBlendedIds = new Set(blended.slice(0, k * 2).map((b) => b.id));
        const candidatesForRerank: Candidate[] = [];
        const seen = new Set<string>();
        
        for (const c of [...keyword, ...semantic]) {
          if (topBlendedIds.has(c.chunkId) && !seen.has(c.chunkId)) {
            candidatesForRerank.push(c);
            seen.add(c.chunkId);
          }
        }

        const candidateIds = candidatesForRerank.map((c) => c.chunkId);
        const fullRows =
          candidateIds.length === 0
            ? []
            : await prisma.documentChunk.findMany({
                where: { id: { in: candidateIds } },
                select: { id: true, content: true },
              });
        const contentById = new Map(fullRows.map((r) => [r.id, r.content]));
        const fullCandidates: RerankCandidate[] = candidatesForRerank.map((c) => ({
          ...c,
          content: contentById.get(c.chunkId) ?? c.snippet,
        }));
        
        const reranked = await tracer.startActiveSpan("rerank", async (rSpan) => {
          const res = await rerank(query, fullCandidates);
          rSpan.end();
          return res;
        });
        
        blended = reranked.map(r => ({ id: r.chunkId, score: r.score }));
      }

      const topIds = blended.slice(0, k).map((b) => b.id);
      if (topIds.length === 0) return [];

      const rows = await prisma.$queryRaw<
        { chunkId: string; documentId: string; title: string; fileType: string; content: string }[]
      >`
        SELECT dc.id::text           AS "chunkId",
               dc."documentId"::text AS "documentId",
               d.title               AS title,
               d."fileType"          AS "fileType",
               dc.content            AS content
        FROM document_chunks dc
        JOIN documents d ON d.id = dc."documentId"
        WHERE dc.id::text = ANY(${topIds})
      `;
      const byId = new Map(rows.map((r) => [r.chunkId, r]));

      return topIds
        .map((id, i) => {
          const r = byId.get(id);
          return r ? { marker: i + 1, ...r } : null;
        })
        .filter((c): c is RetrievedContext => c !== null);
    } finally {
      span.end();
    }
  });
}
````

### `apps/web/lib/hybrid.ts`

_64 lines_

````ts
export interface Scored {
  id: string;
  score: number;
}

/**
 * Keyword weight in [0, 1] for the hybrid blend; semantic weight is (1 - weight).
 * Chosen by the weight sweep in the eval harness, not guessed. Re-run `pnpm eval`
 * after corpus/backend changes and update this if the sweep's best weight moves.
 *
 * History, because this constant drifted from the sweep once and the drift was invisible:
 * Elasticsearch BM25 scores moved the optimum 0.5 → 0.4; the IF-3 held-out split then selected
 * 0.55, and this constant was NOT updated, so production served 0.4 while every published hybrid
 * number described 0.55. Re-selected at 0.45 on 2026-08-05 once the harness was fixed to retrieve
 * at production depth on both legs. The sweep plateau is wide and flat (0.20–0.70 all score 0.98
 * on the tuning split), so treat this as the centre of a plateau, not a sharp optimum.
 */
export const DEFAULT_HYBRID_WEIGHT = 0.45;

/** Min-max normalize scores to [0, 1] within a single list (keyed by id). */
function normalize(items: Scored[]): Map<string, number> {
  const out = new Map<string, number>();
  if (items.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const i of items) {
    if (i.score < min) min = i.score;
    if (i.score > max) max = i.score;
  }
  const range = max - min;
  for (const i of items) {
    // All-equal scores → treat every present item as fully relevant (1).
    out.set(i.id, range === 0 ? 1 : (i.score - min) / range);
  }
  return out;
}

/**
 * Blend two scored lists into one ranked list.
 *
 * Keyword (ts_rank) and semantic (cosine) scores live on different scales, so each
 * list is min-max normalized before blending. An item missing from a list contributes
 * 0 for that component, so items found by both strategies are naturally rewarded.
 */
export function blendHybrid(
  keyword: Scored[],
  semantic: Scored[],
  weight: number = DEFAULT_HYBRID_WEIGHT,
): Scored[] {
  const kw = normalize(keyword);
  const sm = normalize(semantic);
  const ids = new Set<string>([...kw.keys(), ...sm.keys()]);

  const blended: Scored[] = [];
  for (const id of ids) {
    const score = weight * (kw.get(id) ?? 0) + (1 - weight) * (sm.get(id) ?? 0);
    // Drop items with no contribution under this weight (e.g. at weight=1 a
    // semantic-only hit scores 0). Keeps the endpoints honest: weight=1 behaves
    // like keyword-only, weight=0 like semantic-only.
    if (score > 0) blended.push({ id, score });
  }
  blended.sort((a, b) => b.score - a.score);
  return blended;
}
````

### `apps/web/lib/acl.ts`

_156 lines_

````ts
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bumpAclVersion, projectNow } from "@/lib/outbox";

/**
 * Permission model for permission-aware search. A document is visible to a viewer if
 * it is public, the viewer owns it, or a grant targets the viewer directly or via a
 * group they belong to. The same rule is enforced on both retrieval legs:
 *
 *   - Elasticsearch (keyword): each chunk carries a denormalised `acl` list of principal
 *     tokens; the query filters with `terms` on the viewer's principals (index-side).
 *   - Postgres (semantic): the same rule expressed as a SQL predicate over the ownership
 *     + grant tables (see lib/retrieve.ts).
 *
 * A principal token is one of: "public", `user:<userId>`, or `group:<groupId>`. A
 * document's tokens are the union of its visibility; a viewer's tokens are everything
 * they can act as. Visibility holds iff the two sets intersect — which is exactly the
 * `terms` filter, and mirrors the SQL EXISTS checks.
 */

export const PUBLIC = "public";
export const userToken = (userId: string) => `user:${userId}`;
export const groupToken = (groupId: string) => `group:${groupId}`;

/** Who is asking. `userId` is null for an anonymous/signed-out request (sees public only). */
export interface Viewer {
  userId: string | null;
  principals: string[]; // always includes PUBLIC
}

/**
 * Build the principal set for a viewer: "public", their own user token, and a group
 * token per group they belong to. One membership query; anonymous viewers skip it.
 */
export async function viewerFrom(userId: string | null): Promise<Viewer> {
  const principals = [PUBLIC];
  if (userId) {
    principals.push(userToken(userId));
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    for (const m of memberships) principals.push(groupToken(m.groupId));
  }
  return { userId, principals };
}

/**
 * Prisma `where` fragment selecting the documents a viewer may see — the same rule the
 * retrieval SQL predicate encodes (lib/retrieve `visibleToViewer`), expressed for the
 * Prisma query builder so the management/list surfaces stay consistent with search. An
 * anonymous viewer (null userId) sees only public documents.
 */
export function documentVisibilityWhere(viewer: Viewer): Prisma.DocumentWhereInput {
  const uid = viewer.userId;
  return {
    OR: [
      { isPublic: true },
      ...(uid
        ? [
            { ownerId: uid },
            { grants: { some: { userId: uid } } },
            { grants: { some: { group: { members: { some: { userId: uid } } } } } },
          ]
        : []),
    ],
  };
}

/**
 * The single read-authorization gate for a specific document.
 *
 * Retrieval filters visibility *in the query* (ES `terms`, SQL predicate), which covers search
 * and RAG. Anything that reaches a document by id instead — file download, metadata by id — has
 * no such filter and MUST call this. It is built on `documentVisibilityWhere`, so this gate and
 * the list/search surfaces can never drift apart: one rule, one place.
 */
export async function canReadDocument(viewer: Viewer, documentId: string): Promise<boolean> {
  const hit = await prisma.document.findFirst({
    where: { AND: [{ id: documentId }, documentVisibilityWhere(viewer)] },
    select: { id: true },
  });
  return hit !== null;
}

/** Thrown by the assert helpers below; carries the HTTP status a route should return. */
export class AccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * Assert the viewer may read the document, else throw a 404 — deliberately NOT 403.
 * A 403 on an existing-but-forbidden document confirms the document exists, which leaks
 * membership of the corpus to anyone probing ids. Unreadable and absent look identical.
 */
export async function assertCanRead(viewer: Viewer, documentId: string): Promise<void> {
  if (!(await canReadDocument(viewer, documentId))) {
    throw new AccessError(404, "Document not found.");
  }
}

/** The minimal document shape needed to compute its ACL tokens for indexing. */
export interface AclDocument {
  isPublic: boolean;
  ownerId: string | null;
  grants: { userId: string | null; groupId: string | null }[];
}

/**
 * The denormalised principal tokens for a document — written into each of its ES chunks
 * so keyword search can filter at the index. Kept in sync whenever ownership/grants
 * change (ingest, and reindexDocumentAcl).
 */
export function aclTokens(doc: AclDocument): string[] {
  const tokens = new Set<string>();
  if (doc.isPublic) tokens.add(PUBLIC);
  if (doc.ownerId) tokens.add(userToken(doc.ownerId));
  for (const g of doc.grants) {
    if (g.userId) tokens.add(userToken(g.userId));
    if (g.groupId) tokens.add(groupToken(g.groupId));
  }
  return [...tokens];
}

/** Load a document's ACL tokens from Postgres (owner + public flag + grants). */
export async function documentAclTokens(documentId: string): Promise<string[]> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { isPublic: true, ownerId: true, grants: { select: { userId: true, groupId: true } } },
  });
  return doc ? aclTokens(doc) : [];
}

/**
 * Record that a document's ACL changed and bring the keyword index in line.
 *
 * Call after changing ownership, `isPublic`, or grants. This bumps the document's `aclVersion`
 * and writes an outbox event in one transaction, then projects inline so the change is visible
 * immediately; if that inline attempt fails, the committed outbox row guarantees the drainer
 * picks it up.
 *
 * It used to write Elasticsearch directly with `updateDocumentAcl`, which had two failure modes:
 * an update-by-query matched nothing when the document's chunks did not exist yet (so a revoke
 * during an in-flight index was simply lost), and a failed write left no record that ES still
 * owed an update. The `refresh` parameter is retained for call-site compatibility; projection is
 * always refresh-synchronous now.
 */
export async function syncDocumentAcl(documentId: string, _refresh = false): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await bumpAclVersion(tx, documentId);
  });
  await projectNow(documentId);
}
````

### `apps/web/lib/es.ts`

_284 lines_

````ts
import { Client } from "@elastic/elasticsearch";

/**
 * Elasticsearch keyword index (plan §7). Chunks are dual-written here on ingest
 * (Postgres holds the source of truth + embeddings; ES owns keyword search,
 * BM25 ranking, and highlighting). The eval harness spins up ephemeral indices
 * so it can measure the real BM25 keyword strategy without touching prod data.
 */
export const ES_URL = process.env.ES_URL ?? "http://localhost:9200";
export const CHUNK_INDEX = process.env.ES_INDEX ?? "indexflow_chunks";

// Highlight sentinels — the search route HTML-escapes the snippet, then swaps these
// for <mark> so raw chunk content can't inject markup (XSS-safe highlighting).
export const HL_START = "@@HL_START@@";
export const HL_END = "@@HL_END@@";

let client: Client | undefined;
export function es(): Client {
  // Lazy singleton so importing this module (e.g. during `next build`) never connects.
  client ??= new Client({ node: ES_URL });
  return client;
}

const MAPPING = {
  properties: {
    chunk_id: { type: "keyword" },
    document_id: { type: "keyword" },
    chunk_index: { type: "integer" },
    title: { type: "text" },
    file_type: { type: "keyword" },
    content: { type: "text" },
    // Denormalised ACL principal tokens ("public" | "user:<id>" | "group:<id>") for
    // permission-aware keyword search — filtered with `terms` against the viewer (lib/acl).
    acl: { type: "keyword" },
    // Projection versions copied from the source document (lib/outbox.ts). They let the
    // projector tell a fresh write from one built on a stale snapshot, and let the reconciler
    // spot drift without re-reading every chunk's content.
    acl_version: { type: "integer" },
    content_version: { type: "integer" },
    metadata: { type: "object", enabled: false },
    created_at: { type: "date" },
  },
} as const;

export async function ensureChunkIndex(index: string = CHUNK_INDEX): Promise<void> {
  const exists = await es().indices.exists({ index });
  if (!exists) {
    // ignore 400 "resource_already_exists" from a concurrent creator.
    await es()
      .indices.create({ index, mappings: MAPPING })
      .catch((e) => {
        if (e?.meta?.body?.error?.type !== "resource_already_exists_exception") throw e;
      });
    return;
  }
  // Index predates a field added to MAPPING (e.g. `acl`): putMapping is additive and
  // idempotent, so it registers new keyword fields on an existing index without a reindex.
  // Existing chunks are repopulated separately by es:backfill.
  await es().indices.putMapping({ index, properties: MAPPING.properties });
}

export async function deleteIndex(index: string): Promise<void> {
  await es().indices.delete({ index }, { ignore: [404] });
}

/** Fresh, uniquely-named index for a single eval run (torn down afterward). */
export async function createEphemeralIndex(prefix = "indexflow_eval"): Promise<string> {
  const index = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await es().indices.create({ index, mappings: MAPPING });
  return index;
}

export interface EsChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  fileType: string;
  content: string;
  acl?: string[]; // ACL principal tokens for this chunk's document (lib/acl aclTokens)
  aclVersion?: number;
  contentVersion?: number;
  createdAt?: Date;
}

type Refresh = boolean | "wait_for";

export async function indexChunks(
  chunks: EsChunk[],
  index: string = CHUNK_INDEX,
  refresh: Refresh = false,
): Promise<void> {
  if (chunks.length === 0) return;
  const operations = chunks.flatMap((c) => [
    { index: { _index: index, _id: c.chunkId } },
    {
      chunk_id: c.chunkId,
      document_id: c.documentId,
      chunk_index: c.chunkIndex,
      title: c.title,
      file_type: c.fileType,
      content: c.content,
      acl: c.acl ?? [],
      acl_version: c.aclVersion ?? 0,
      content_version: c.contentVersion ?? 0,
      created_at: c.createdAt ?? new Date(),
    },
  ]);
  const res = await es().bulk({ operations, refresh });
  if (res.errors) {
    const firstErr = res.items.find((i) => i.index?.error)?.index?.error;
    throw new Error(`ES bulk index failed: ${JSON.stringify(firstErr)}`);
  }
}

/**
 * Re-set the ACL principal list on every chunk of a document in place, without
 * re-embedding — used when ownership/grants change after indexing. No-op if the index
 * or document isn't present yet.
 */
export async function updateDocumentAcl(
  documentId: string,
  acl: string[],
  index: string = CHUNK_INDEX,
  refresh: Refresh = false,
): Promise<void> {
  await es()
    .updateByQuery(
      {
        index,
        query: { term: { document_id: documentId } },
        script: { source: "ctx._source.acl = params.acl", params: { acl } },
        conflicts: "proceed",
        refresh: refresh === true,
      },
      { ignore: [404] },
    )
    .catch((e) => {
      if (e?.meta?.statusCode === 404) return;
      throw e;
    });
}

/** Remove all chunks for a document. No-op if the index doesn't exist yet. */
export async function deleteDocumentChunks(
  documentId: string,
  index: string = CHUNK_INDEX,
  refresh: Refresh = false,
): Promise<void> {
  await es()
    .deleteByQuery(
      { index, query: { term: { document_id: documentId } }, conflicts: "proceed", refresh: refresh === true },
      { ignore: [404] },
    )
    .catch((e) => {
      if (e?.meta?.statusCode === 404) return;
      throw e;
    });
}

/**
 * What the keyword index currently believes about a document: how many chunks it holds and at
 * which projection versions. Versions come back as -1 when nothing is indexed, so a first
 * projection (version 0 or 1) always compares as newer.
 */
export async function getProjectionState(
  documentId: string,
  index: string = CHUNK_INDEX,
): Promise<{ chunkCount: number; aclVersion: number; contentVersion: number }> {
  try {
    const res = await es().search<{ acl_version?: number; content_version?: number }>({
      index,
      size: 1,
      track_total_hits: true,
      query: { term: { document_id: documentId } },
      _source: ["acl_version", "content_version"],
    });
    const total = typeof res.hits.total === "number" ? res.hits.total : (res.hits.total?.value ?? 0);
    const src = res.hits.hits[0]?._source;
    return {
      chunkCount: total,
      aclVersion: src?.acl_version ?? -1,
      contentVersion: src?.content_version ?? -1,
    };
  } catch (e: any) {
    if (e?.meta?.statusCode === 404) return { chunkCount: 0, aclVersion: -1, contentVersion: -1 };
    throw e;
  }
}

/**
 * How many chunks the keyword index currently holds for a document. Used by the consistency
 * check and the reconciler to compare the ES projection against Postgres, which is the source
 * of truth. Returns 0 when the index does not exist yet.
 */
export async function countDocumentChunks(
  documentId: string,
  index: string = CHUNK_INDEX,
): Promise<number> {
  try {
    const res = await es().count({ index, query: { term: { document_id: documentId } } });
    return res.count;
  } catch (e: any) {
    if (e?.meta?.statusCode === 404) return 0;
    throw e;
  }
}

export interface EsKeywordHit {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string; // sentinel-highlighted; caller escapes + swaps to <mark>
  score: number; // BM25 (unbounded → normalize for display)
}

interface ChunkSource {
  chunk_id: string;
  document_id: string;
  title: string;
  file_type: string;
  content: string;
}

/**
 * BM25 keyword search over chunk content (title lightly boosted), with highlighted
 * fragments. Returns [] if the index doesn't exist yet (nothing indexed).
 */
export async function keywordSearch(
  q: string,
  fileType: string | null,
  size: number,
  index: string = CHUNK_INDEX,
  aclPrincipals: string[] | null = null,
): Promise<EsKeywordHit[]> {
  // Permission-aware filter: keep only chunks whose document ACL intersects the viewer's
  // principals. `null` = no ACL filter (eval/admin contexts); an empty array matches
  // nothing. This runs index-side so restricted chunks never reach the ranker.
  const filter: Record<string, unknown>[] = [];
  if (fileType) filter.push({ term: { file_type: fileType } });
  if (aclPrincipals) filter.push({ terms: { acl: aclPrincipals } });

  const res = await es()
    .search<ChunkSource>(
      {
        index,
        size,
        query: {
          bool: {
            must: [{ multi_match: { query: q, fields: ["content", "title^2"], operator: "or" } }],
            ...(filter.length ? { filter } : {}),
          },
        },
        highlight: {
          pre_tags: [HL_START],
          post_tags: [HL_END],
          fields: { content: { fragment_size: 160, number_of_fragments: 2 } },
        },
      },
      { ignore: [404] },
    )
    .catch((e) => {
      if (e?.meta?.statusCode === 404) return null;
      throw e;
    });

  if (!res || !res.hits?.hits) return [];

  return res.hits.hits.map((h) => {
    const src = h._source!;
    const fragments = h.highlight?.content;
    const snippet =
      fragments && fragments.length > 0 ? fragments.join(" … ") : src.content.slice(0, 320);
    return {
      chunkId: src.chunk_id,
      documentId: src.document_id,
      title: src.title,
      fileType: src.file_type,
      snippet,
      score: h._score ?? 0,
    };
  });
}
````

### `apps/web/lib/outbox.ts`

_304 lines_

````ts
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
  await deleteDocumentChunks(documentId, index, true);
  await indexChunks(esChunks, index, "wait_for");

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
````

### `apps/web/lib/embed.ts`

_62 lines_

````ts
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Local sentence embeddings via all-MiniLM-L6-v2 (384-dim), run through ONNX in-process.
 * No API key, no network at query time after the first model download. Vectors are
 * mean-pooled and L2-normalized, so cosine similarity == dot product.
 */
export const EMBED_DIM = 384;
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

// Cache the pipeline across requests (and across hot reloads in dev).
const globalForEmbed = globalThis as unknown as {
  __embedExtractor?: Promise<FeatureExtractionPipeline>;
};

function getExtractor(): Promise<FeatureExtractionPipeline> {
  globalForEmbed.__embedExtractor ??= pipeline("feature-extraction", EMBED_MODEL);
  return globalForEmbed.__embedExtractor;
}

/**
 * How many texts go through the model at once.
 *
 * transformers.js pads a batch to its longest sequence and allocates one tensor for the whole
 * batch, so cost is `batch × longest_sequence × 384` floats — quadratic in practice, because a
 * bigger batch is also likelier to contain a long text. Passing 11,562 chunks in a single call
 * asks for roughly 4.5 GB and is killed by the OS; that is not hypothetical, it happened on a CI
 * runner during the Phase 8 scale-up. 64 keeps peak allocation in the tens of megabytes with no
 * measurable throughput loss.
 */
const EMBED_BATCH = Number(process.env.EMBED_BATCH ?? 64);

/**
 * Embed texts. Returns one 384-dim unit vector per input, in input order.
 *
 * Batched internally, so callers can pass an arbitrarily long list without having to know the
 * memory characteristics of the model.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const output = await extractor(texts.slice(i, i + EMBED_BATCH), {
      pooling: "mean",
      normalize: true,
    });
    out.push(...(output.tolist() as number[][]));
  }
  return out;
}

/** Embed a single text. */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}

/** Format a number[] as a pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
````

### `apps/web/lib/chunk.ts`

_71 lines_

````ts
export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

const TARGET_WORDS = 180;
const OVERLAP_WORDS = 30;

/** Rough token estimate (~0.75 words/token English). Good enough for display + budgeting. */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 0.75));
}

/**
 * Split text into overlapping chunks on paragraph boundaries, packing paragraphs
 * up to ~TARGET_WORDS. Long paragraphs are word-windowed. Overlap preserves context
 * across chunk boundaries so a match near an edge still has surrounding text.
 */
export function chunkText(raw: string): Chunk[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Fall back to the whole text as one block if there are no paragraph breaks.
  const blocks = paragraphs.length > 0 ? paragraphs : [text];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join("\n\n"));
    current = [];
    currentWords = 0;
  };

  for (const block of blocks) {
    const blockWords = block.split(/\s+/).filter(Boolean);

    // Oversized paragraph: window it on its own.
    if (blockWords.length > TARGET_WORDS) {
      flush();
      let start = 0;
      while (start < blockWords.length) {
        const end = Math.min(start + TARGET_WORDS, blockWords.length);
        chunks.push(blockWords.slice(start, end).join(" "));
        if (end >= blockWords.length) break;
        start = end - OVERLAP_WORDS;
      }
      continue;
    }

    if (currentWords + blockWords.length > TARGET_WORDS) flush();
    current.push(block);
    currentWords += blockWords.length;
  }
  flush();

  return chunks.map((content, index) => ({
    index,
    content,
    tokenCount: estimateTokens(content),
  }));
}
````

### `apps/web/lib/rerank.ts`

_66 lines_

````ts
import { AutoModelForSequenceClassification, AutoTokenizer, softmax } from "@huggingface/transformers";
import type { Candidate } from "./retrieve";

/**
 * Cross-encoder reranking.
 *
 * Retrieval gives us a cheap shortlist. The reranker then scores each (query, passage) pair
 * jointly in one sequence-classification model. That is the important bit: the model sees both
 * strings at the same time, so it can judge relevance directly instead of comparing independent
 * vectors. It is slower than keyword/vector retrieval, so callers only pass top-k candidates.
 */

export const RERANK_MODEL = "Xenova/bge-reranker-base";

export type RerankCandidate = Candidate & { content?: string };

interface Reranker {
  tokenizer: any;
  model: any;
}

// Global cache so the tokenizer/model load only once per worker/process.
let reranker: Promise<Reranker> | null = null;

async function getReranker(): Promise<Reranker> {
  reranker ??= Promise.all([
    AutoTokenizer.from_pretrained(RERANK_MODEL),
    AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL),
  ]).then(([tokenizer, model]) => ({ tokenizer, model }));
  return reranker;
}

export function rerankScoreFromLogits(logits: number[]): number {
  if (logits.length === 0) return Number.NEGATIVE_INFINITY;
  // Many rerankers are regression-style models with a single relevance logit. Raw logit is fine
  // for ranking because only ordering matters. Two-class classifiers use the positive class.
  if (logits.length === 1) return logits[0];
  const probs = Array.from(softmax(logits));
  return probs[1] ?? probs[probs.length - 1] ?? Number.NEGATIVE_INFINITY;
}

function passageText(c: RerankCandidate): string {
  return (c.content ?? c.snippet ?? "").replace(/@@HL_START@@|@@HL_END@@/g, "");
}

export async function rerank(query: string, candidates: RerankCandidate[]): Promise<Candidate[]> {
  if (candidates.length === 0) return [];

  const { tokenizer, model } = await getReranker();
  const queries = candidates.map(() => query);
  const passages = candidates.map(passageText);
  const inputs = tokenizer(queries, {
    text_pair: passages,
    padding: true,
    truncation: true,
  });
  const outputs = await model(inputs);
  const rows = outputs.logits.tolist() as number[][];

  const scoredCandidates = candidates.map((c, i) => ({
    ...c,
    score: rerankScoreFromLogits(rows[i] ?? []),
  }));

  return scoredCandidates.sort((a, b) => b.score - a.score);
}
````

### `apps/web/lib/rag.ts`

_31 lines_

````ts
import { retrieveContexts, type RetrievedContext } from "@/lib/retrieve";
import { streamAnswer, type AnswerContext } from "@/lib/llm";
import type { Viewer } from "@/lib/acl";

/**
 * RAG orchestration: hybrid retrieval (lib/retrieve) → grounded answer (lib/llm).
 * Retrieval and generation are separate so the search route, the answer route, and the
 * generation eval all share one retriever and one prompt.
 *
 * The answer inherits the viewer's ACL: contexts come from the permission-aware
 * retriever, so the generator can only ever ground (and cite) documents the viewer is
 * allowed to see — a restricted document cannot leak into an answer even indirectly.
 */

export const RAG_K = 6;

export function toAnswerContexts(contexts: RetrievedContext[]): AnswerContext[] {
  return contexts.map((c) => ({ marker: c.marker, title: c.title, content: c.content }));
}

/**
 * Retrieve, then return the answer as a provider-neutral event stream. `answer` is null
 * when nothing was retrieved, so the caller can refuse without spending a generation.
 */
export async function answerQuestion(query: string, viewer: Viewer, k = RAG_K) {
  const start = performance.now();
  const contexts = await retrieveContexts(query, k, viewer);
  const retrievalMs = performance.now() - start;
  const answer = contexts.length > 0 ? streamAnswer(query, toAnswerContexts(contexts)) : null;
  return { contexts, answer, retrievalMs };
}
````

### `apps/web/lib/llm.ts`

_295 lines_

````ts
import { Ollama } from "ollama";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("indexflow-web");

/**
 * Local LLM layer for Stage B (grounded RAG answers + LLM-as-judge eval), served entirely
 * by Ollama — no API keys, no network, consistent with the local MiniLM embeddings. This
 * file is the only provider-specific seam: it exposes provider-neutral shapes
 * (`AnswerEvent`, `JudgeResult`) so the answer route, RAG orchestrator, eval harness, and
 * UI never import an SDK.
 *
 * Models (all local, all overridable by env):
 *   - generation:  llama3.2:3b        — streams the grounded answer
 *   - faithfulness: bespoke-minicheck — a purpose-built grounded-factuality checker,
 *                   run per claim ("is this supported by the context? yes/no")
 *   - relevance/citations: qwen2.5:7b — structured-JSON judge
 * Generation and judging use different models, so there is no self-preference bias.
 */

let client: Ollama | undefined;
export function ollama(): Ollama {
  // Lazy singleton so importing this module (e.g. during `next build`) never connects.
  client ??= new Ollama(process.env.OLLAMA_HOST ? { host: process.env.OLLAMA_HOST } : undefined);
  return client;
}

export const GEN_MODEL = process.env.RAG_MODEL ?? "llama3.2:3b";
export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "qwen2.5:7b"; // relevance + citations
export const FAITHFULNESS_MODEL = process.env.FAITHFULNESS_MODEL ?? "bespoke-minicheck"; // per-claim grounding

/** The minimal shape the generator/judge need for each cited passage. */
export interface AnswerContext {
  marker: number; // 1-based; the model cites this as [n]
  title: string;
  content: string;
}

// The sentence the model is asked to produce when the context can't answer.
export const REFUSAL_SENTENCE =
  "I don't have enough information in the indexed documents to answer that.";

// Small local models paraphrase, so match the refusal loosely rather than exactly.
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.startsWith("i don't have enough information") ||
    t.startsWith("i do not have enough information") ||
    t.includes("enough information in the indexed") ||
    t.includes("don't have enough information in the")
  );
}

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

const GROUNDING_SYSTEM = `You are IndexFlow's answer assistant. Answer the user's question using ONLY the numbered context passages provided below — never outside knowledge.

Rules:
- Cite every factual claim with its passage number in square brackets, e.g. [1] or [2][3].
- Keep the answer concise: 1–4 sentences. Do not restate the question.
- If the passages do not contain enough information to answer, reply with exactly this sentence and nothing else: "${REFUSAL_SENTENCE}"
- Never invent facts, sources, or citations. If unsure, refuse using the sentence above.`;

export function renderContexts(contexts: AnswerContext[]): string {
  return contexts.map((c) => `[${c.marker}] Title: ${c.title}\n${c.content}`).join("\n\n");
}

function genMessages(question: string, contexts: AnswerContext[]) {
  return [
    { role: "system", content: GROUNDING_SYSTEM },
    { role: "user", content: `Context passages:\n\n${renderContexts(contexts)}\n\n---\nQuestion: ${question}` },
  ];
}

// ── Generation (provider-neutral event stream) ──────────────────────────────

export type AnswerEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      text: string;
      inputTokens: number | null;
      outputTokens: number | null;
      refused: boolean;
    };

/** Stream a grounded answer as text deltas, ending with a `done` event. */
export async function* streamAnswer(
  question: string,
  contexts: AnswerContext[],
): AsyncGenerator<AnswerEvent> {
  const span = tracer.startSpan("streamAnswer");
  span.setAttribute("model", GEN_MODEL);
  try {
    const res = await ollama().chat({
      model: GEN_MODEL,
      messages: genMessages(question, contexts),
      stream: true,
      options: { temperature: 0 },
    });
    let full = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    for await (const part of res) {
      const t = part.message?.content ?? "";
      if (t) {
        full += t;
        yield { type: "delta", text: t };
      }
      if (part.done) {
        inputTokens = part.prompt_eval_count ?? inputTokens;
        outputTokens = part.eval_count ?? outputTokens;
      }
    }
    span.setAttribute("inputTokens", inputTokens ?? 0);
    span.setAttribute("outputTokens", outputTokens ?? 0);
    yield { type: "done", text: full.trim(), inputTokens, outputTokens, refused: looksLikeRefusal(full) };
  } finally {
    span.end();
  }
}

/** Non-streaming generation for the eval harness. `keepAlive` controls model residency. */
export async function generateAnswer(
  question: string,
  contexts: AnswerContext[],
  keepAlive?: string | number,
): Promise<{ text: string; outputTokens: number | null; refused: boolean }> {
  return tracer.startActiveSpan("generateAnswer", async (span) => {
    span.setAttribute("model", GEN_MODEL);
    try {
      const res = await ollama().chat({
        model: GEN_MODEL,
        messages: genMessages(question, contexts),
        stream: false,
        keep_alive: keepAlive,
        options: { temperature: 0 },
      });
      const text = res.message.content.trim();
      span.setAttribute("outputTokens", res.eval_count ?? 0);
      return { text, outputTokens: res.eval_count ?? null, refused: looksLikeRefusal(text) };
    } finally {
      span.end();
    }
  });
}

/**
 * Free a model from memory (Ollama unloads on `keep_alive: 0`). The eval harness runs the
 * three models (generator, relevance judge, minicheck) in phases and unloads between them,
 * so only one is ever resident — essential on an 8 GB box where all three (~11 GB) can't
 * coexist without swap-thrashing a cold load past the client's fetch timeout.
 */
export async function unloadModel(model: string): Promise<void> {
  try {
    await ollama().generate({ model, prompt: "", keep_alive: 0 });
  } catch {
    // best-effort: if the unload call fails, the model just lingers until keep_alive expires
  }
}

/**
 * Load a model with a single, isolated request before batching work at it.
 *
 * Cold-loading a large model is slow (bespoke-minicheck: ~3min for its 5.5GB on an 8GB box)
 * and Node's fetch caps a response at 300s, so firing concurrent requests at a cold model
 * makes every one of them race the same load and time out together. Warming serialises that
 * cost into one call. A timed-out attempt is not fatal: the server keeps loading regardless,
 * so a retry lands on an already-resident model.
 */
export async function warmModel(model: string, keepAlive: string | number = "10m"): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ollama().generate({ model, prompt: "ok", keep_alive: keepAlive, options: { num_predict: 1 } });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ── LLM-as-judge ────────────────────────────────────────────────────────────

export interface JudgeResult {
  faithfulness: number; // 0..1 fraction of answer claims supported by the context (minicheck)
  unsupported_claims: string[]; // claims minicheck marked unsupported
  answer_relevance: number; // 0..1 (qwen)
  citation_correctness: number; // 0..1 (qwen)
  refused: boolean;
  reasoning: string;
}

// Split an answer into atomic claims for per-claim grounding checks.
export function splitClaims(answer: string): string[] {
  return answer
    .replace(/\[\d+\]/g, " ") // strip citation markers
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

// bespoke-minicheck: "is this claim supported by the document?" → Yes/No.
export async function claimSupported(
  context: string,
  claim: string,
  keepAlive?: string | number,
): Promise<boolean> {
  const res = await ollama().chat({
    model: FAITHFULNESS_MODEL,
    messages: [{ role: "user", content: `Document: ${context}\n\nClaim: ${claim}` }],
    stream: false,
    keep_alive: keepAlive,
    options: { temperature: 0 },
  });
  return /^\s*yes/i.test(res.message.content);
}

// qwen scores relevance + citation correctness + refusal via constrained JSON.
const QWEN_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    answer_relevance: { type: "number" },
    citation_correctness: { type: "number" },
    refused: { type: "boolean" },
  },
  required: ["reasoning", "answer_relevance", "citation_correctness", "refused"],
} as const;

const JUDGE_SYSTEM = `You are a strict, fair evaluator of retrieval-augmented answers. Judge ONLY against the provided context — never outside knowledge. Score answer_relevance (0..1, how directly the answer addresses the question) and citation_correctness (0..1, fraction of the answer's [n] citations whose passage actually supports the sentence; 1.0 if the answer correctly refuses). Set refused=true if the answer declined / said the context lacks the information. Return only the required JSON.`;

export async function relevanceJudge(
  question: string,
  contextText: string,
  answer: string,
  keepAlive?: string | number,
): Promise<{ answer_relevance: number; citation_correctness: number; refused: boolean; reasoning: string }> {
  const res = await ollama().chat({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      {
        role: "user",
        content: `Question:\n${question}\n\nContext passages the answer was allowed to use:\n\n${contextText}\n\n---\nAnswer to evaluate:\n${answer}\n\nReturn the JSON.`,
      },
    ],
    format: QWEN_JUDGE_SCHEMA,
    stream: false,
    keep_alive: keepAlive,
    // num_predict caps a runaway judge, it is not a tuning knob: observed verdicts run ~40 tokens
    // (reasoning 124-227 chars), so 96 leaves headroom and rarely binds. Note the failure mode if
    // it ever does — the constrained JSON is truncated mid-object and the parse below falls to the
    // catch, scoring the item 0. Raise it rather than trimming the schema if that starts happening.
    options: { temperature: 0, num_predict: 96 },
  });
  try {
    const j = JSON.parse(res.message.content) as Record<string, unknown>;
    return {
      answer_relevance: clamp01(j.answer_relevance),
      citation_correctness: clamp01(j.citation_correctness),
      refused: Boolean(j.refused),
      reasoning: String(j.reasoning ?? ""),
    };
  } catch {
    return { answer_relevance: 0, citation_correctness: 0, refused: false, reasoning: "judge returned unparseable output" };
  }
}

export async function judge(
  question: string,
  contexts: AnswerContext[],
  answer: string,
): Promise<JudgeResult> {
  const contextText = renderContexts(contexts);
  const rel = await relevanceJudge(question, contextText, answer);

  // A refusal is vacuously faithful (no claims to support) — don't run minicheck on it.
  if (rel.refused || looksLikeRefusal(answer)) {
    return { faithfulness: 1, unsupported_claims: [], ...rel, refused: true };
  }

  const claims = splitClaims(answer);
  if (claims.length === 0) {
    return { faithfulness: 1, unsupported_claims: [], ...rel };
  }
  const checks = await Promise.all(
    claims.map(async (c) => ({ claim: c, ok: await claimSupported(contextText, c) })),
  );
  const unsupported = checks.filter((x) => !x.ok).map((x) => x.claim);
  const faithfulness = (claims.length - unsupported.length) / claims.length;
  return { faithfulness, unsupported_claims: unsupported, ...rel };
}
````

### `apps/web/lib/ratelimit.ts`

_170 lines_

````ts
import { NextRequest, NextResponse } from "next/server";

/**
 * Per-caller rate limiting and global concurrency guards for the public demo.
 *
 * Why this exists: `/api/eval` and `/api/eval/rag` run a full evaluation on demand — seeding a
 * corpus, embedding it, and (for the RAG one) driving local LLMs for tens of minutes. On a public
 * URL with guest access, an unauthenticated visitor could start as many as they liked and flatten
 * the box. Search and answer are cheaper but still do real embedding work per call.
 *
 * SCOPE — read before trusting this:
 *   - State is IN-MEMORY, so limits are PER PROCESS and reset on restart or redeploy. That is
 *     sufficient for the single-container demo this is written for, and it deliberately avoids
 *     adding a Redis dependency to a deployment that otherwise does not need one. Behind multiple
 *     instances, the effective limit multiplies by the instance count.
 *   - It is NOT a defence against a distributed or determined attacker; IP keys are cheap to
 *     rotate. It stops accidental hammering and casual abuse. Anything stronger belongs at the
 *     edge (host WAF / CDN rate limiting), in front of the app.
 *   - The concurrency guard below is the part that actually protects the machine: it caps how
 *     many expensive evaluations can run at once regardless of who asks.
 */

interface Window {
  count: number;
  resetAt: number; // epoch ms
}

export interface RateLimitRule {
  /** Max requests allowed per window, per caller. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

const buckets = new Map<string, Window>();

// Bound memory: a flood of unique keys must not grow the map without limit. When we exceed the
// cap we drop already-expired entries first, and if that is not enough, the oldest ones.
const MAX_KEYS = 10_000;

function sweep(now: number) {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
  if (buckets.size <= MAX_KEYS) return;
  const overflow = buckets.size - MAX_KEYS;
  let dropped = 0;
  for (const k of buckets.keys()) {
    buckets.delete(k);
    if (++dropped >= overflow) break;
  }
}

/**
 * Fixed-window counter. Chosen over a sliding window because the failure mode we care about is
 * "someone is hammering an expensive endpoint", where a burst at a window boundary is harmless.
 */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) sweep(now);

  const existing = buckets.get(key);
  const win: Window =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };

  win.count += 1;
  buckets.set(key, win);

  const remaining = Math.max(0, rule.limit - win.count);
  return {
    ok: win.count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt: win.resetAt,
    retryAfterSec: Math.max(1, Math.ceil((win.resetAt - now) / 1000)),
  };
}

/** Test/maintenance hook — drops all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Identify the caller. A signed-in user is keyed by id so they are not punished for sharing an IP
 * (office NAT, mobile carrier); everyone else falls back to IP.
 *
 * NOTE on x-forwarded-for: the leftmost entry is the client as reported by the first proxy, and
 * it is trivially spoofable when the app is exposed directly. It is only meaningful when a trusted
 * proxy sits in front and overwrites it — which is the case on the managed hosts this demo targets.
 * Do not treat the resulting key as an identity.
 */
export function callerKey(req: NextRequest, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
  return `ip:${ip}`;
}

/** Standard rate-limit headers, set on allowed and rejected responses alike. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(Math.ceil((r.resetAt - Date.now()) / 1000)),
  };
}

/** The 429 to return when a caller is over their limit. */
export function tooManyRequests(r: RateLimitResult, message: string): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSeconds: r.retryAfterSec },
    {
      status: 429,
      headers: { ...rateLimitHeaders(r), "Retry-After": String(r.retryAfterSec) },
    },
  );
}

/**
 * Global concurrency guard — the real protection for expensive work.
 *
 * A rate limit still lets N different callers each start one evaluation simultaneously. This caps
 * the total in flight regardless of who asks, so the box cannot be driven into swap by a handful
 * of coordinated (or merely unlucky) requests.
 */
const inFlight = new Map<string, number>();

export function tryAcquire(slot: string, max = 1): boolean {
  const current = inFlight.get(slot) ?? 0;
  if (current >= max) return false;
  inFlight.set(slot, current + 1);
  return true;
}

export function release(slot: string): void {
  const current = inFlight.get(slot) ?? 0;
  if (current <= 1) inFlight.delete(slot);
  else inFlight.set(slot, current - 1);
}

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Per-surface limits, all overridable by env so a deployment can tighten them without a rebuild.
 * Defaults are generous enough that ordinary local development never notices them, and tight
 * enough that a public demo cannot be trivially exhausted.
 */
export const LIMITS = {
  /** Cheap-ish: one embedding per query. */
  search: { limit: envInt("RL_SEARCH_PER_MIN", 30), windowMs: 60_000 },
  /** Retrieval + (locally) generation. */
  answer: { limit: envInt("RL_ANSWER_PER_MIN", 10), windowMs: 60_000 },
  /** Writes: storage + a queued ingestion job. */
  upload: { limit: envInt("RL_UPLOAD_PER_HOUR", 20), windowMs: 3_600_000 },
  /** Expensive: seeds and embeds a whole corpus per call. */
  evalRetrieval: { limit: envInt("RL_EVAL_PER_10MIN", 3), windowMs: 600_000 },
  /** Very expensive: drives local LLMs, tens of minutes per call. */
  evalRag: { limit: envInt("RL_EVAL_RAG_PER_HOUR", 1), windowMs: 3_600_000 },
} satisfies Record<string, RateLimitRule>;
````

### 2.3 Worker

The `apps/web/worker/` directory contains exactly one file.

### `apps/web/worker/index.ts`

_97 lines_

````ts
/**
 * BullMQ ingestion worker. Run: pnpm --filter @indexflow/web worker
 *
 * Consumes the "ingestion" queue: marks the job/document RUNNING, indexes the document
 * (download → chunk → embed → store), then marks it COMPLETED/INDEXED. Failures (after
 * retries) mark the job/document FAILED with the error message.
 */
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { ingestDocument } from "../lib/ingest";
import { INGESTION_QUEUE, connection, type IngestionJobData } from "../lib/queue";
import { drainOutbox, reconcile } from "../lib/outbox";

const worker = new Worker<IngestionJobData>(
  INGESTION_QUEUE,
  async (job) => {
    const { documentId, jobId } = job.data;
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.document.update({ where: { id: documentId }, data: { status: "INDEXING" } });

    const chunkCount = await ingestDocument(documentId);

    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    console.log(`[worker] indexed ${documentId} (${chunkCount} chunks)`);
  },
  // Configurable so the ingestion benchmark can measure throughput against worker count, and so
  // a deployment can match concurrency to its core count. Embedding is CPU-bound and in-process,
  // so raising this past the core count buys nothing — see bench/ingest-bench.ts.
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("failed", async (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
  if (!job) return;
  // Only mark terminal state once retries are exhausted.
  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const { documentId, jobId } = job.data;
  await prisma.ingestionJob
    .update({ where: { id: jobId }, data: { status: "FAILED", error: err.message, completedAt: new Date() } })
    .catch(() => {});
  await prisma.document.update({ where: { id: documentId }, data: { status: "FAILED" } }).catch(() => {});
});

/**
 * Outbox drainer. The inline projection in lib/outbox projectNow() covers the happy path; this
 * is what makes the guarantee durable when it does not — a transient Elasticsearch outage, or a
 * process that died between committing Postgres and projecting.
 */
const DRAIN_INTERVAL_MS = Number(process.env.OUTBOX_DRAIN_INTERVAL_MS ?? 5_000);
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 300_000);

const drainTimer = setInterval(() => {
  drainOutbox().then(
    ({ processed, failed }) => {
      if (processed || failed) console.log(`[outbox] drained ${processed} ok, ${failed} failed`);
    },
    (e) => console.error("[outbox] drain error:", e instanceof Error ? e.message : e),
  );
}, DRAIN_INTERVAL_MS);

/**
 * Periodic reconciliation. The outbox guarantees an update is owed; it cannot guarantee one ever
 * landed, and nothing stops Elasticsearch being changed out from under us. This sweep compares
 * both stores and queues repairs for anything that has drifted.
 */
const reconcileTimer = setInterval(() => {
  reconcile().then(
    ({ checked, repaired }) => {
      if (repaired.length) {
        console.warn(`[reconcile] ${repaired.length}/${checked} document(s) drifted; repair queued`);
      }
    },
    (e) => console.error("[reconcile] error:", e instanceof Error ? e.message : e),
  );
}, RECONCILE_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} — shutting down`);
  clearInterval(drainTimer);
  clearInterval(reconcileTimer);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log("[worker] listening on the ingestion queue…");
console.log(
  `[worker] outbox drain every ${DRAIN_INTERVAL_MS}ms, reconcile every ${RECONCILE_INTERVAL_MS}ms`,
);
````

### 2.4 API routes

### `apps/web/app/api/search/route.ts`

_122 lines_

````ts
import { NextRequest, NextResponse } from "next/server";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT } from "@/lib/hybrid";
import { HL_START, HL_END } from "@/lib/es";
import { fetchKeyword, fetchSemantic, toScored, type Candidate } from "@/lib/retrieve";
import { auth } from "@/auth";
import { viewerFrom, type Viewer } from "@/lib/acl";
import { LIMITS, callerKey, checkRateLimit, rateLimitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { recordSearch } from "@/lib/usage";

export const runtime = "nodejs";

type SearchMode = "keyword" | "semantic" | "hybrid";
const MODES: SearchMode[] = ["keyword", "semantic", "hybrid"];

const RESULT_LIMIT = 20;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderHighlighted(raw: string): string {
  return escapeHtml(raw).split(HL_START).join("<mark>").split(HL_END).join("</mark>");
}

interface Hit {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string;
  score: number;
  source: SearchMode;
}

function formatKeyword(cands: Candidate[]): Hit[] {
  const max = cands.reduce((m, c) => Math.max(m, c.score), 0) || 1;
  return cands.slice(0, RESULT_LIMIT).map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    title: c.title,
    fileType: c.fileType,
    snippet: renderHighlighted(c.snippet),
    score: Number((c.score / max).toFixed(3)), // BM25 is unbounded → normalize for display
    source: "keyword" as const,
  }));
}

function formatSemantic(cands: Candidate[]): Hit[] {
  return cands.slice(0, RESULT_LIMIT).map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    title: c.title,
    fileType: c.fileType,
    snippet: escapeHtml(c.snippet),
    score: Number(c.score.toFixed(3)), // cosine is already 0..1
    source: "semantic" as const,
  }));
}

async function hybridSearch(q: string, fileType: string | null, viewer: Viewer): Promise<Hit[]> {
  const [keyword, semantic] = await Promise.all([
    fetchKeyword(q, fileType, viewer),
    fetchSemantic(q, fileType, viewer),
  ]);

  const blended = blendHybrid(toScored(keyword), toScored(semantic), DEFAULT_HYBRID_WEIGHT);

  // Prefer the keyword candidate (it carries a highlighted snippet); fall back to semantic.
  const kwById = new Map(keyword.map((c) => [c.chunkId, c]));
  const smById = new Map(semantic.map((c) => [c.chunkId, c]));

  const hits: Hit[] = [];
  for (const { id, score } of blended.slice(0, RESULT_LIMIT)) {
    const kw = kwById.get(id);
    const sm = smById.get(id);
    const meta = kw ?? sm!;
    hits.push({
      chunkId: id,
      documentId: meta.documentId,
      title: meta.title,
      fileType: meta.fileType,
      snippet: kw ? renderHighlighted(kw.snippet) : escapeHtml(sm!.snippet),
      score: Number(score.toFixed(3)),
      source: "hybrid",
    });
  }
  return hits;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const fileType = req.nextUrl.searchParams.get("fileType")?.trim() || null;
  const requested = req.nextUrl.searchParams.get("mode") as SearchMode | null;
  const mode: SearchMode = requested && MODES.includes(requested) ? requested : "keyword";

  if (!q) {
    return NextResponse.json({ query: "", mode, latencyMs: 0, results: [] });
  }

  // Permission-aware: retrieval only ever returns chunks this viewer can see. An
  // unauthenticated request resolves to a public-only viewer.
  const session = await auth();

  // Every query embeds the text, so this is not free. Limit per caller.
  const rl = checkRateLimit(`search:${callerKey(req, session?.user?.id ?? null)}`, LIMITS.search);
  if (!rl.ok) return tooManyRequests(rl, "Too many searches. Please slow down.");

  const viewer = await viewerFrom(session?.user?.id ?? null);

  const started = performance.now();
  let results: Hit[];
  if (mode === "hybrid") {
    results = await hybridSearch(q, fileType, viewer);
  } else if (mode === "semantic") {
    results = formatSemantic(await fetchSemantic(q, fileType, viewer));
  } else {
    results = formatKeyword(await fetchKeyword(q, fileType, viewer));
  }
  const latencyMs = Math.round(performance.now() - started);
  recordSearch();

  return NextResponse.json({ query: q, mode, latencyMs, results }, { headers: rateLimitHeaders(rl) });
}
````

### `apps/web/app/api/answer/route.ts`

_138 lines_

````ts
import { NextRequest } from "next/server";
import { answerQuestion, RAG_K } from "@/lib/rag";
import { retrieveContexts } from "@/lib/retrieve";
import { REFUSAL_SENTENCE } from "@/lib/llm";
import { auth } from "@/auth";
import { viewerFrom } from "@/lib/acl";
import { DEMO_MODE } from "@/lib/demo";
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { recordAnswerUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Streaming grounded-answer endpoint. Responds with newline-delimited JSON frames:
 *   {"type":"contexts","contexts":[{marker,chunkId,documentId,title,fileType}]}  (first)
 *   {"type":"delta","text":"..."}                                                (0..n)
 *   {"type":"done","refused":bool,"usage":{output_tokens}|null}                  (last)
 *   {"type":"error","error":"..."}                                              (on failure)
 * Citations metadata comes first so the UI can wire [n] chips before text arrives.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { q?: unknown };
  const query = typeof body.q === "string" ? body.q.trim() : "";
  if (!query) {
    return Response.json({ error: "Missing query 'q'." }, { status: 400 });
  }

  // Permission-aware: the answer is grounded only in documents this viewer can see, so a
  // restricted document can never be retrieved, cited, or paraphrased into the answer.
  const session = await auth();

  // Retrieval plus (locally) generation — the most expensive per-request path a visitor can
  // reach. Checked before any work starts.
  const rl = checkRateLimit(`answer:${callerKey(req, session?.user?.id ?? null)}`, LIMITS.answer);
  if (!rl.ok) return tooManyRequests(rl, "Too many questions. Please slow down.");

  const viewer = await viewerFrom(session?.user?.id ?? null);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Enqueue that tolerates a client that has already disconnected.
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          return true;
        } catch {
          closed = true; // controller cancelled (client went away)
          return false;
        }
      };

      try {
        // Public demo: there is no Ollama on the host, so retrieval still runs for real (the
        // citations below are genuine, permission-filtered hits) but generation is replaced by
        // an explanation rather than a broken stream or a fabricated answer.
        if (DEMO_MODE) {
          const contexts = await retrieveContexts(query, RAG_K, viewer);
          send({
            type: "contexts",
            contexts: contexts.map((c) => ({
              marker: c.marker,
              chunkId: c.chunkId,
              documentId: c.documentId,
              title: c.title,
              fileType: c.fileType,
            })),
          });
          send({
            type: "delta",
            text:
              contexts.length > 0
                ? `Answer generation is disabled in this public demo — it runs on a local Ollama model that isn't available on the host. Retrieval is live: the ${contexts.length} passage(s) cited below are real, permission-filtered results for your query. Run the project locally to see grounded answers with citations.`
                : "Answer generation is disabled in this public demo, and retrieval found no matching passages for this query.",
          });
          recordAnswerUsage(null, null);
          send({ type: "done", refused: false, usage: null });
          controller.close();
          return;
        }

        const { contexts, answer } = await answerQuestion(query, viewer);
        send({
          type: "contexts",
          contexts: contexts.map((c) => ({
            marker: c.marker,
            chunkId: c.chunkId,
            documentId: c.documentId,
            title: c.title,
            fileType: c.fileType,
          })),
        });

        // Nothing retrieved → refuse without spending a generation.
        if (!answer) {
          send({ type: "delta", text: REFUSAL_SENTENCE });
          recordAnswerUsage(null, null);
          send({ type: "done", refused: true, usage: null });
          controller.close();
          return;
        }

        for await (const ev of answer) {
          const ok =
            ev.type === "delta"
              ? send({ type: "delta", text: ev.text })
            : (recordAnswerUsage(ev.inputTokens, ev.outputTokens),
              send({
                type: "done",
                refused: ev.refused,
                usage: ev.outputTokens != null ? { output_tokens: ev.outputTokens } : null,
              }));
          if (!ok) break; // client disconnected — stop consuming the model stream
        }
        if (!closed) controller.close();
      } catch (e) {
        // Log the real cause server-side; never leak internals (DB host, stack) to the client.
        console.error("answer route failed", e);
        send({
          type: "error",
          error: "Couldn't generate an answer — the search backend may be unavailable.",
        });
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
````

### `apps/web/app/api/documents/[id]/sharing/route.ts`

_77 lines_

````ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertOwner, getSharing, setPublic, addGrant, removeGrant, SharingError } from "@/lib/sharing";
import { DEMO_MODE, demoReadOnlyResponse } from "@/lib/demo";

export const runtime = "nodejs";

/**
 * Owner-only document sharing:
 *   GET    → current sharing state { isPublic, ownerId, grants[] }
 *   PATCH  → { isPublic } toggle public visibility
 *   POST   → { email } | { groupName } add a grant
 *   DELETE → ?grantId=… revoke a grant
 * Every mutation re-syncs the document's ACL into Elasticsearch (see lib/sharing).
 */

const currentUserId = async () => (await auth())?.user?.id ?? null;

function fail(e: unknown): NextResponse {
  if (e instanceof SharingError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e; // unexpected → 500 via the framework
}

/** Read-only public demo: refuse every sharing mutation. GET (reading state) stays allowed. */
function demoBlocked(): NextResponse | null {
  return DEMO_MODE ? NextResponse.json(demoReadOnlyResponse, { status: 403 }) : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await assertOwner(id, await currentUserId());
    return NextResponse.json(await getSharing(id));
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = demoBlocked();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { isPublic?: unknown };
  try {
    await assertOwner(id, await currentUserId());
    return NextResponse.json(await setPublic(id, Boolean(body.isPublic)));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = demoBlocked();
  if (blocked) return blocked;
  const body = (await req.json().catch(() => ({}))) as { email?: string; groupName?: string };
  try {
    await assertOwner(id, await currentUserId());
    return NextResponse.json(await addGrant(id, body), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = demoBlocked();
  if (blocked) return blocked;
  const grantId = req.nextUrl.searchParams.get("grantId");
  try {
    await assertOwner(id, await currentUserId());
    if (!grantId) throw new SharingError(400, "Missing grantId.");
    return NextResponse.json(await removeGrant(id, grantId));
  } catch (e) {
    return fail(e);
  }
}
````

### `apps/web/app/api/chunks/[id]/route.ts`

_76 lines_

````ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccessError, assertCanRead, viewerFrom } from "@/lib/acl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exact source-passage viewer.
 *
 * Search snippets and citation chips identify a chunk id. This route hydrates that id back to
 * the exact passage text from Postgres, after applying the same document read gate used by file
 * download. Unreadable chunks are 404s so chunk ids cannot be used to probe private documents.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const chunk = await prisma.documentChunk.findUnique({
    where: { id },
    select: {
      id: true,
      chunkIndex: true,
      content: true,
      tokenCount: true,
      documentId: true,
      document: {
        select: {
          id: true,
          title: true,
          fileName: true,
          fileType: true,
          status: true,
          aclVersion: true,
          contentVersion: true,
          uploadedAt: true,
          indexedAt: true,
          _count: { select: { chunks: true } },
        },
      },
    },
  });
  if (!chunk) return NextResponse.json({ error: "Passage not found." }, { status: 404 });

  const session = await auth();
  const viewer = await viewerFrom(session?.user?.id ?? null);
  try {
    await assertCanRead(viewer, chunk.documentId);
  } catch (e) {
    if (e instanceof AccessError) {
      return NextResponse.json({ error: "Passage not found." }, { status: e.status });
    }
    throw e;
  }

  return NextResponse.json({
    id: chunk.id,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    tokenCount: chunk.tokenCount,
    document: {
      id: chunk.document.id,
      title: chunk.document.title,
      fileName: chunk.document.fileName,
      fileType: chunk.document.fileType,
      status: chunk.document.status,
      aclVersion: chunk.document.aclVersion,
      contentVersion: chunk.document.contentVersion,
      uploadedAt: chunk.document.uploadedAt,
      indexedAt: chunk.document.indexedAt,
      chunkCount: chunk.document._count.chunks,
    },
  });
}
````

### 2.5 Evaluation entry points

The request asked for "the eval entry point(s) that compute MRR/nDCG and run the blend-weight
sweep". That is three files, all included:

- **`eval/metrics.ts`** — the metric implementations themselves (`mrr`, `ndcgAt`, `ndcgAtGraded`,
  `recallAt`, `precisionAt`, `hitRateAt`, plus attainable-ceiling and bootstrap helpers).
- **`eval/harness.ts`** — the harness that indexes the corpus, retrieves, and runs the
  blend-weight sweep (`SWEEP`, the `balanced()` per-kind criterion, plateau detection).
- **`eval/run.ts`** — the CLI entry point that invokes the harness, prints the report, and exits
  non-zero on gate failure.

### `apps/web/eval/metrics.ts`

_344 lines_

````ts
/**
 * Retrieval metrics — the measuring instrument.
 *
 * Extracted from harness.ts so the instrument can be tested independently of the retrieval it
 * measures. Every function here is pure: no I/O, no services, no clock. That is what lets the
 * synthetic-ranker suite (test/unit/metrics.test.ts) assert exact values against hand-derived
 * expectations, and it is why these run in the unit job on every push rather than in the
 * services-bound eval job.
 *
 * Behaviour is byte-for-byte what harness.ts computed before the extraction. Where a convention
 * is debatable it is documented rather than silently chosen — see `ceilingFor` for the
 * consequences of the `total === 0` handling.
 */

/** The only thing the metrics need from a labelled query: which documents count as relevant. */
export interface Labeled {
  relevant: string[];
}

/**
 * How many queries a ranking metric is defined over.
 *
 * A query with no relevant document cannot be ranked well or badly — there is nothing to put at
 * rank 1 — so it is excluded from the denominator of every ranking metric rather than scored as a
 * miss. This matches `trec_eval`, which averages only over queries present in the qrels file.
 *
 * Retrieving nothing for an unanswerable query is *correct behaviour*, and the ranking metrics are
 * the wrong instrument to credit it with. It is measured separately as a rejection signal — see
 * the `rejection` block in the eval report.
 */
export const judgedCount = (evals: Labeled[]): number =>
  evals.reduce((n, e) => n + (e.relevant.length > 0 ? 1 : 0), 0);

/**
 * Collapse a chunk-ordered ranking to a document ranking, keeping first appearance.
 *
 * On the current 17-document corpus every document is a single chunk, so this is a no-op; it
 * matters as soon as documents chunk into more than one piece.
 */
export function dedupDocs(ordered: { docId: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ordered) {
    if (!seen.has(r.docId)) {
      seen.add(r.docId);
      out.push(r.docId);
    }
  }
  return out;
}

/** 1-based ranks at which relevant documents appear, ascending. */
export function ranksForQuery(docs: string[], relevant: string[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (relevant.includes(docs[i])) r.push(i + 1);
  }
  return r;
}

/** Mean recall@k over judged queries. */
export function recallAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    const total = evals[i].relevant.length;
    if (total === 0) continue;
    sum += rankings[i].filter((r) => r <= k).length / total;
  }
  return sum / n;
}

/**
 * Fraction of judged queries with **at least one** relevant document in the top k.
 *
 * This is what people usually mean by "the right answer was first N% of the time", and it is NOT
 * what `recallAt(…, 1)` measures. Recall@1 divides by the number of relevant documents, so a query
 * with two relevant documents can score at most 0.5 at k=1 no matter how good the ranking is — on
 * the in-domain label set that caps recall@1 at 31/33 for a perfect ranker. Hit rate has no such
 * cap: a perfect ranker scores exactly 1.0.
 *
 * Both are reported. Recall@k is the standard and comparable to published baselines; hit rate is
 * the one that means what a reader assumes it means.
 */
export function hitRateAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    if (evals[i].relevant.length === 0) continue;
    if (rankings[i].some((r) => r <= k)) sum += 1;
  }
  return sum / n;
}

/**
 * Mean reciprocal rank of the first relevant document, over judged queries. A judged query whose
 * relevant document was never retrieved scores 0; an unjudged query is not scored at all.
 */
export function mrr(rankings: number[][], evals: Labeled[]): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    if (evals[i].relevant.length === 0) continue;
    sum += rankings[i].length > 0 ? 1 / rankings[i][0] : 0;
  }
  return sum / n;
}

/**
 * Mean precision@k over judged queries. Divides by k, not by min(k, total) — the standard
 * convention, but it means a query with one relevant document can score at most 1/k. On a corpus
 * labelled one-document-per-query that puts the attainable maximum near 1/k, which is easy to
 * misread as a poor score. This is why `ceilingFor` exists and why the report prints it.
 */
export function precisionAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    if (evals[i].relevant.length === 0) continue;
    sum += rankings[i].filter((x) => x <= k).length / k;
  }
  return sum / n;
}

/**
 * Mean nDCG@k with binary gain, over judged queries.
 *
 * DCG sums 1/log2(rank+1) over relevant documents inside the cut; IDCG is the same sum over the
 * first min(k, total) positions — the `ndcg_cut` convention, verified against pytrec_eval.
 */
export function ndcgAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    const total = evals[i].relevant.length;
    if (total === 0) continue;
    let idcg = 0;
    for (let j = 1; j <= Math.min(k, total); j++) idcg += 1 / Math.log2(j + 1);
    let dcg = 0;
    for (const rank of rankings[i]) {
      if (rank <= k) dcg += 1 / Math.log2(rank + 1);
    }
    sum += dcg / idcg;
  }
  return sum / n;
}

/**
 * The best score a perfect ranker could achieve on this label set — the value an oracle that puts
 * every relevant document at the top would score.
 *
 * Excluding unanswerable queries removes one cause of a sub-1.0 ceiling, but not the other: label
 * density still binds. recall@k is capped at min(k, total)/total per query and precision@k at
 * min(k, total)/k, so a set labelled one-relevant-document-per-query caps P@3 near 1/3 and holds
 * R@1 below 1 for every multi-relevant query.
 *
 * Reporting a score without its ceiling is how a saturated benchmark passes for a good one, and
 * how a structurally capped metric passes for a bad score. On this corpus P@3 = 36% is not a poor
 * precision — it is 97% of everything attainable.
 */
export function ceilingFor(evals: Labeled[], metric: "mrr" | "ndcg", k?: number): number;
export function ceilingFor(evals: Labeled[], metric: "recall" | "precision", k: number): number;
export function ceilingFor(
  evals: Labeled[],
  metric: "mrr" | "recall" | "precision" | "ndcg",
  k = 0,
): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (const e of evals) {
    const total = e.relevant.length;
    if (total === 0) continue;
    if (metric === "mrr" || metric === "ndcg") sum += 1;
    else if (metric === "recall") sum += Math.min(k, total) / total;
    else sum += Math.min(k, total) / k;
  }
  return sum / n;
}

/** A metric expressed as a fraction of what this label set makes attainable. */
export const fractionOfCeiling = (value: number, ceiling: number): number =>
  ceiling === 0 ? 0 : value / ceiling;

// ── graded relevance ──────────────────────────────────────────────────────
/**
 * A query whose judgments carry a gain, not just membership.
 *
 * The binary functions above take `rankings: number[][]` — the *positions* of relevant documents —
 * which is sufficient for MRR, recall and precision but throws away which document sits at each
 * position. Graded nDCG needs the gain at each rank, so it takes the ranked document ids instead.
 */
export interface GradedLabeled {
  relevant: Map<string, number>;
}

/** Positions (1-based) of relevant documents, so the binary metrics can score a ranked id list. */
export const ranksFromRanked = (ranked: string[], relevant: Map<string, number>): number[] => {
  const out: number[] = [];
  for (let i = 0; i < ranked.length; i++) if (relevant.has(ranked[i])) out.push(i + 1);
  return out;
};

/**
 * Mean nDCG@k with **linear** gain — `trec_eval`'s `ndcg_cut` convention, so numbers stay
 * comparable to published BEIR baselines. Gain is the judgment value itself (1, or 2 for
 * NFCorpus's higher grade), not 2^rel − 1.
 *
 * The ideal ranking is the query's own gains sorted descending and truncated at k, so a query with
 * more relevant documents than k is not penalised for being unable to show them all.
 */
export function ndcgAtGraded(ranked: string[][], rows: GradedLabeled[], k: number): number {
  const n = rows.reduce((c, r) => c + (r.relevant.size > 0 ? 1 : 0), 0);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const rel = rows[i].relevant;
    if (rel.size === 0) continue;

    let dcg = 0;
    const list = ranked[i] ?? [];
    for (let p = 0; p < Math.min(k, list.length); p++) {
      const gain = rel.get(list[p]) ?? 0;
      if (gain > 0) dcg += gain / Math.log2(p + 2);
    }

    const ideal = [...rel.values()].sort((a, b) => b - a).slice(0, k);
    let idcg = 0;
    for (let p = 0; p < ideal.length; p++) idcg += ideal[p] / Math.log2(p + 2);

    if (idcg > 0) sum += dcg / idcg;
  }
  return sum / n;
}

/** Deterministic mulberry32. Fixed seed so a published interval does not jitter between runs. */
export function seededRandom(seed = 0x9e3779b9): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

/** Percentile bootstrap of the mean: resample with replacement, take the 2.5th/97.5th percentiles. */
export function bootstrapCI(perQuery: number[], samples = 2000): Interval {
  const n = perQuery.length;
  if (n === 0) return { value: 0, lo: 0, hi: 0 };
  const value = perQuery.reduce((a, b) => a + b, 0) / n;
  const rand = seededRandom();
  const means: number[] = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += perQuery[(rand() * n) | 0];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { value, lo: means[Math.floor(0.025 * samples)], hi: means[Math.floor(0.975 * samples) - 1] };
}

export interface Delta extends Interval {
  /** True iff the 95% interval on the paired difference lies wholly above or wholly below zero. */
  excludesZero: boolean;
}

/**
 * Paired percentile bootstrap of a difference between two strategies.
 *
 * The two strategies are scored on the *same* queries, so the correct comparison resamples
 * **query indices** and averages the per-query difference — not the two means independently.
 * Overlapping marginal intervals do not imply an insignificant difference: per-query correlation
 * is variance that the paired difference removes and two marginal intervals keep. On a set this
 * small that difference routinely decides whether a real effect is visible at all.
 *
 * Both vectors must be indexed by the same queries, in the same order.
 */
export function bootstrapDelta(a: number[], b: number[], samples = 2000): Delta {
  if (a.length !== b.length) {
    throw new Error(`bootstrapDelta needs paired vectors, got ${a.length} and ${b.length}`);
  }
  const n = a.length;
  if (n === 0) return { value: 0, lo: 0, hi: 0, excludesZero: false };

  const diff = a.map((x, i) => x - b[i]);
  const value = diff.reduce((s, d) => s + d, 0) / n;
  const rand = seededRandom();
  const means: number[] = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diff[(rand() * n) | 0];
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const lo = means[Math.floor(0.025 * samples)];
  const hi = means[Math.floor(0.975 * samples) - 1];
  return { value, lo, hi, excludesZero: lo > 0 || hi < 0 };
}

/**
 * Top raw retrieval score per query, split by whether the query is answerable.
 *
 * The rejection question — "did the strategy correctly return nothing?" — cannot be asked of the
 * ranking metrics, and cannot be asked of the blended hybrid score at all: `blendHybrid` min-max
 * normalises per query, so the top blended score is 1.0 for every query regardless of whether
 * anything relevant was found. Only raw leg scores carry absolute information, and of those only
 * cosine similarity is comparable across queries; BM25 is not, because its scale moves with the
 * query's term IDFs.
 *
 * So this reports the separation rather than a rate: if the top score on an unanswerable query
 * falls inside the range of top scores on answerable ones, no threshold can tell them apart.
 */
export interface RejectionSignal {
  unanswerableTop: number[];
  answerableTop: { min: number; median: number; max: number };
  /** True iff every unanswerable query scores below every answerable one. */
  separable: boolean;
}

export function rejectionSignal(
  tops: { top: number; answerable: boolean }[],
): RejectionSignal {
  const un = tops.filter((t) => !t.answerable).map((t) => t.top);
  const an = tops.filter((t) => t.answerable).map((t) => t.top).sort((a, b) => a - b);
  const median = an.length === 0 ? 0 : an[Math.floor(an.length / 2)];
  return {
    unanswerableTop: un,
    answerableTop: { min: an[0] ?? 0, median, max: an[an.length - 1] ?? 0 },
    separable: un.length > 0 && an.length > 0 && Math.max(...un) < Math.min(...an),
  };
}
````

### `apps/web/eval/harness.ts`

_669 lines_

````ts
/**
 * Shared retrieval evaluation harness.
 *
 * Seeds a labeled corpus into BOTH stores, mirroring production: semantic candidates come
 * from pgvector inside a Postgres transaction that is ROLLED BACK (never touches real
 * data), and keyword candidates come from a real Elasticsearch BM25 query against an
 * EPHEMERAL index that is torn down afterward. Index scans are disabled so semantic
 * ranking is exact (brute-force KNN) rather than approximate HNSW.
 *
 * Doc/chunk ids are generated in app code so the same id keys a Postgres row and an ES
 * document — the hybrid blend correlates keyword + semantic hits by chunk id, exactly as
 * the production search route does.
 *
 * Used by the CLI (eval/run.ts) and the API route (app/api/eval/route.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral } from "../lib/embed";
import { blendHybrid, type Scored } from "../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../lib/es";
import { rerank } from "../lib/rerank";
import { CANDIDATE_LIMIT } from "../lib/retrieve";
import {
  bootstrapCI,
  bootstrapDelta,
  ceilingFor,
  dedupDocs,
  judgedCount,
  mrr,
  ndcgAt,
  precisionAt,
  hitRateAt,
  ranksForQuery,
  recallAt,
  rejectionSignal,
  type Delta,
  type Interval,
  type RejectionSignal,
} from "./metrics";
import corpus from "./corpus.json";
import queries from "./queries.json";

type Strategy = "keyword" | "semantic" | "hybrid" | "hybrid+rerank";
type QueryKind = "exact" | "paraphrase";
/** Held-out discipline: the hybrid weight is chosen on "tune" and reported on "test". */
type Split = "tune" | "test";

interface ChunkHit {
  chunkId: string;
  docId: string;
  score: number;
  snippet?: string;
}
interface QueryEval {
  queryText: string;
  kind: QueryKind;
  split: Split;
  relevant: string[];
  kw: ChunkHit[]; // keyword candidates, ordered by score desc
  sm: ChunkHit[]; // semantic candidates, ordered by similarity desc
  hybridRerankDocs?: string[]; // populated after sweep
  rerankScores?: Record<string, number>;
}

export interface StrategyMetrics {
  recall: { 1: number; 3: number; 5: number };
  precision: { 3: number };
  ndcg: { 5: number };
  mrr: number;
}
export interface KindMetrics {
  r1: number;
  mrr: number;
}
export interface GateRow {
  name: string;
  value: number;
  floor: number;
  pass: boolean;
}
export interface Regression {
  query: string;
  expectedDoc: string;
  hybridRank: number | null;
  rerankRank: number | null;
  kwScore: number;
  smScore: number;
  rerankerScore: number | null;
  likelyReason: string;
}
/** A pairwise comparison between two strategies on the same queries. */
export interface StrategyDelta {
  a: Strategy;
  b: Strategy;
  delta: Delta;
}

/**
 * What was measured, and on which data. Recorded in the report so a published number can always
 * be traced to the exact dataset that produced it — the fingerprints change if anyone edits a
 * query or a document.
 */
export interface DatasetInfo {
  version: string;
  queriesSha: string;
  corpusSha: string;
  numQueries: number;
  numTune: number;
  numTest: number;
  /** Held-out queries with at least one relevant document — the denominator of every metric. */
  numTestJudged: number;
  numDocs: number;
}

/**
 * The best each metric could possibly score on this label set. Printed beside every reported
 * value so a saturated benchmark is visible in the run log rather than inferable from the labels.
 */
export interface Ceilings {
  recall: { 1: number; 3: number; 5: number };
  precision: { 3: number };
  ndcg: { 5: number };
  mrr: number;
}

/**
 * Whether a strategy could tell an unanswerable query from an answerable one, if it were allowed
 * to return nothing. Reported as separation, not as a rate — see `rejectionSignal`.
 */
export interface RejectionReport {
  numAnswerable: number;
  numUnanswerable: number;
  legs: Record<"keyword" | "semantic", RejectionSignal>;
  /** Why this is descriptive rather than a scored metric on the current label set. */
  caveat: string;
}

export interface EvalReport {
  numQueries: number;
  numDocs: number;
  hybridWeight: number;
  /**
   * Candidates actually retrieved per leg, after clamping to corpus size. Recorded because the
   * run output previously asserted "10 chunks per strategy" while the keyword leg retrieved every
   * chunk in the corpus — a false provenance line captured verbatim into RESULTS.md.
   */
  depths: RetrievalDepths;
  /** Provenance of the numbers below. */
  dataset: DatasetInfo;
  /**
   * Headline metrics are computed on the HELD-OUT split. The hybrid weight is chosen by the
   * sweep on the tuning split only, so these numbers are not reported on data that selected
   * them. `strategiesAll` keeps the whole-set figures for continuity with earlier runs.
   */
  strategiesAll: Record<Strategy, StrategyMetrics>;
  /** Marginal 95% bootstrap CIs on the held-out split, for every strategy. */
  ci: { mrr: Record<Strategy, Interval>; r1: Record<Strategy, Interval>; r5: Record<Strategy, Interval> };
  /**
   * Paired bootstrap on the per-query MRR difference, for every ordered pair. This is the test
   * that answers "is A better than B"; the marginal intervals above cannot, because they discard
   * the per-query pairing.
   */
  deltas: StrategyDelta[];
  strategies: Record<Strategy, StrategyMetrics>;
  /** By query kind on the HELD-OUT split — what the gate scores. */
  byKind: Record<QueryKind, Record<Strategy, KindMetrics>>;
  /** By query kind on tune+test, kept for continuity with numbers published before 2026-08-05. */
  byKindAll: Record<QueryKind, Record<Strategy, KindMetrics>>;
  /** Attainable maxima for `strategies`, on the held-out split. */
  ceilings: Ceilings;
  /**
   * Share of judged queries with ANY relevant document in the top k — what a reader assumes R@1
   * means. Unlike recall@k it is not capped below 1 by multi-relevant queries.
   */
  hitRate: Record<Strategy, { 1: number; 3: number; 5: number }>;
  /** Correctly returning nothing for an unanswerable query, measured apart from ranking. */
  rejection: RejectionReport;
  sweep: { weight: number; mrr: number }[];
  regressions: Regression[];
  gate: GateRow[];
  passed: boolean;
}

const K_VALUES = [1, 3, 5] as const;
// 0.00 .. 1.00 in 0.05 steps. The coarser 0.1 grid produced a flat plateau that the selection
// rule could not discriminate between, which left an arbitrary tie-break deciding the weight.
const SWEEP = Array.from({ length: 21 }, (_, i) => Number((i / 20).toFixed(2)));

/** Bump when the labelled data changes meaningfully, so old reports stay interpretable. */
const DATASET_VERSION = "2026-07-26.2";
const BOOTSTRAP_SAMPLES = 2000;

const sha8 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);

class Rollback extends Error {}

// ── ranking helpers (pure) ────────────────────────────────────────────────
// The metrics themselves live in eval/metrics.ts so they can be tested against hand-derived
// expectations without standing up Postgres or Elasticsearch. See test/unit/metrics.test.ts.

function hybridDocs(q: QueryEval, weight: number): string[] {
  const toScored = (h: ChunkHit[]): Scored[] => h.map((x) => ({ id: x.chunkId, score: x.score }));
  const chunkToDoc = new Map<string, string>();
  for (const h of [...q.kw, ...q.sm]) chunkToDoc.set(h.chunkId, h.docId);
  const blended = blendHybrid(toScored(q.kw), toScored(q.sm), weight);
  return dedupDocs(blended.map((b) => ({ docId: chunkToDoc.get(b.id)! })));
}

function rankedDocs(q: QueryEval, strat: Strategy, weight: number): string[] {
  if (strat === "keyword") return dedupDocs(q.kw);
  if (strat === "semantic") return dedupDocs(q.sm);
  if (strat === "hybrid+rerank" && q.hybridRerankDocs) return q.hybridRerankDocs;
  return hybridDocs(q, weight);
}

function ranksFor(evals: QueryEval[], strat: Strategy, weight: number): number[][] {
  return evals.map((q) => ranksForQuery(rankedDocs(q, strat, weight), q.relevant));
}

// ── candidate collection ──────────────────────────────────────────────────
/**
 * How many candidates each leg retrieves.
 *
 * These used to be hardcoded and *asymmetric* — keyword at `chunks.length`, semantic at 10 —
 * which is neither what production runs nor a fair comparison between the legs, since
 * `blendHybrid` min-max normalises each list independently and a deeper list has its top
 * compressed toward 1.0. Production retrieves both legs at `CANDIDATE_LIMIT`.
 */
export interface RetrievalDepths {
  keyword: number;
  semantic: number;
}

/** Mirror production. Anything else measures a configuration that does not ship. */
export const PRODUCTION_DEPTHS: RetrievalDepths = {
  keyword: CANDIDATE_LIMIT,
  semantic: CANDIDATE_LIMIT,
};

/** The asymmetric depths every published number before 2026-08-05 was measured at. */
export const LEGACY_DEPTHS: RetrievalDepths = { keyword: Number.MAX_SAFE_INTEGER, semantic: 10 };

export interface Candidates {
  evals: QueryEval[];
  chunkById: Map<string, { content: string }>;
  idByFile: Map<string, string>;
  numChunks: number;
}

/**
 * Seed both stores and retrieve candidates for every query, at the requested depths.
 *
 * Split out of `runEvaluation` so the depth-matrix experiment can reuse one seeding pass:
 * retrieving at depth k returns exactly the first k of a full-depth ranked list for both legs
 * (ES returns BM25's top-k by score; the SQL leg is `ORDER BY ... LIMIT k`), so a single
 * retrieval at maximum depth can be truncated to simulate any shallower configuration exactly.
 */
export async function collectCandidates(
  depths: RetrievalDepths = PRODUCTION_DEPTHS,
): Promise<Candidates> {
  // Pre-generate ids in app code so the same id keys the Postgres row and the ES document.
  const idByFile = new Map<string, string>();
  for (const doc of corpus) idByFile.set(doc.fileName, randomUUID());

  const chunks: { fileName: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  for (const doc of corpus) {
    for (const c of chunkText(doc.content)) {
      chunks.push({ fileName: doc.fileName, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }
  const chunkById = new Map(chunks.map((c) => [c.chunkId, c]));

  const chunkVecs = await embed(chunks.map((c) => c.content));
  const queryVecs = await embed(queries.map((q) => q.q));

  const kwDepth = Math.min(depths.keyword, chunks.length);
  const smDepth = Math.min(depths.semantic, chunks.length);

  const evals: QueryEval[] = [];
  const titleByFile = new Map(corpus.map((d) => [d.fileName, d.title]));

  // Ephemeral ES index for this run's keyword strategy (torn down in finally).
  const esIndex = await createEphemeralIndex();
  try {
    const esChunks: EsChunk[] = chunks.map((c) => ({
      chunkId: c.chunkId,
      documentId: idByFile.get(c.fileName)!,
      chunkIndex: c.index,
      title: titleByFile.get(c.fileName) ?? c.fileName,
      fileType: "md",
      content: c.content,
    }));
    await indexChunks(esChunks, esIndex, "wait_for");

    // Keyword strategy: real BM25 against the ephemeral ES index (no transaction needed).
    const kwByQuery: ChunkHit[][] = [];
    for (const query of queries) {
      const hits = await keywordSearch(query.q, null, kwDepth, esIndex);
      kwByQuery.push(hits.map((h) => ({ chunkId: h.chunkId, docId: h.documentId, score: h.score, snippet: h.snippet })));
    }

    // Semantic strategy: exact pgvector KNN inside a rolled-back transaction.
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
          await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

          console.log("Seeding documents...");
          // 1. Seed database and index
          for (const doc of corpus) {
            await tx.$executeRaw`
              INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
              VALUES (${idByFile.get(doc.fileName)}::uuid, ${doc.title}, ${doc.fileName}, 'md', 'INDEXED', now(), now())
            `;
          }
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            await tx.$executeRaw`
              INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
              VALUES (${c.chunkId}::uuid, ${idByFile.get(c.fileName)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i])}::vector, now())
            `;
          }

          const corpusIds = [...idByFile.values()];

          for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            const vec = toVectorLiteral(queryVecs[i]);
            const sm = await tx.$queryRaw<ChunkHit[]>`
              SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docId",
                     1 - (dc.embedding <=> ${vec}::vector) AS score,
                     left(dc.content, 320) AS snippet
              FROM document_chunks dc
              WHERE dc."documentId"::text = ANY(${corpusIds}) AND dc.embedding IS NOT NULL
              ORDER BY dc.embedding <=> ${vec}::vector
              LIMIT ${smDepth}
            `;
            // Compare against document ids, not filenames (kw/sm rows carry ids).
            const relevantIds = query.relevant.map((f) => idByFile.get(f)!);
            evals.push({
              queryText: query.q,
              kind: query.kind as QueryKind,
              // Default to "test" if a query predates the split labels: unlabelled data must
              // never silently become tuning data, which is the direction that inflates scores.
              split: ((query as { split?: string }).split === "tune" ? "tune" : "test") as Split,
              relevant: relevantIds,
              kw: kwByQuery[i],
              sm,
            });
          }

          throw new Rollback();
        },
        { timeout: 60_000, maxWait: 15_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }

  return { evals, chunkById, idByFile, numChunks: chunks.length };
}

// ── main ──────────────────────────────────────────────────────────────────
export async function runEvaluation(
  depths: RetrievalDepths = PRODUCTION_DEPTHS,
): Promise<EvalReport> {
  const { evals, chunkById, idByFile, numChunks } = await collectCandidates(depths);
  const effectiveDepths: RetrievalDepths = {
    keyword: Math.min(depths.keyword, numChunks),
    semantic: Math.min(depths.semantic, numChunks),
  };

  // Weight sweep on the TUNING split only. Sweeping on everything and then reporting on
  // everything is how a hyperparameter quietly launders itself into the headline metric: the
  // weight is chosen because it flatters these very queries. Held-out numbers come below.
  const tuneRows = evals.filter((e) => e.split === "tune");
  const testRows = evals.filter((e) => e.split === "test");
  const sweepRows = tuneRows.length > 0 ? tuneRows : evals;

  // Selection criterion: BALANCED MRR — the mean of exact-query MRR and paraphrase-query MRR.
  //
  // Plain pooled MRR is the wrong objective here. The tuning split is not balanced by query kind
  // (17 exact vs 13 paraphrase), so pooling lets the larger kind decide the weight: maximising it
  // structurally favours keyword-friendly weights regardless of how the blend actually behaves.
  // Hybrid exists precisely so that neither kind is sacrificed, so the criterion should say that.
  const sweepExact = sweepRows.filter((e) => e.kind === "exact");
  const sweepPara = sweepRows.filter((e) => e.kind === "paraphrase");
  const balanced = (weight: number) => {
    const e = sweepExact.length ? mrr(ranksFor(sweepExact, "hybrid", weight), sweepExact) : 0;
    const p = sweepPara.length ? mrr(ranksFor(sweepPara, "hybrid", weight), sweepPara) : 0;
    if (!sweepExact.length || !sweepPara.length)
      return mrr(ranksFor(sweepRows, "hybrid", weight), sweepRows);
    return (e + p) / 2;
  };

  const sweep = SWEEP.map((weight) => ({ weight, mrr: balanced(weight) }));

  // Tie-break: the MIDDLE of the maximising plateau, not a fixed preferred value. A plateau means
  // the data cannot separate those weights; its centre is the point furthest from wherever the
  // behaviour actually changes, so it is the most stable choice the tuning data supports.
  const bestScore = Math.max(...sweep.map((s) => s.mrr));
  const plateau = sweep.filter((s) => s.mrr >= bestScore - 1e-9).map((s) => s.weight);
  const weight = plateau[Math.floor((plateau.length - 1) / 2)];

  console.log("Reranking hybrid candidates...");
  // 3. Rerank top 10 from hybrid
  let queryCount = 0;
  for (const q of evals) {
    console.log(`  Query ${++queryCount}/${evals.length}: ${q.queryText}`);
    const toScored = (h: ChunkHit[]): Scored[] => h.map((x) => ({ id: x.chunkId, score: x.score }));
    const blended = blendHybrid(toScored(q.kw), toScored(q.sm), weight);
    const topBlendedIds = new Set(blended.slice(0, 10).map((b) => b.id));
    
    const candidatesForRerank: any[] = [];
    const seen = new Set<string>();
    const chunkToDoc = new Map<string, string>();
    
    for (const c of [...q.kw, ...q.sm]) {
      chunkToDoc.set(c.chunkId, c.docId);
      if (topBlendedIds.has(c.chunkId) && !seen.has(c.chunkId)) {
        candidatesForRerank.push({
          ...c,
          title: "",
          fileType: "md",
          snippet: c.snippet ?? "",
          content: chunkById.get(c.chunkId)?.content ?? c.snippet ?? "",
        });
        seen.add(c.chunkId);
      }
    }
    
    const reranked = await rerank(q.queryText, candidatesForRerank);
    q.rerankScores = Object.fromEntries(reranked.map(r => [r.chunkId, r.score]));
    const rerankedBlended = reranked.map(r => ({ id: r.chunkId, score: r.score }));
    q.hybridRerankDocs = dedupDocs(rerankedBlended.map((b) => ({ docId: chunkToDoc.get(b.id)! })));
  }

  console.log("Calculating metrics...");
  // Metrics calculation
  const metricsFor = (rows: QueryEval[], strat: Strategy): StrategyMetrics => {
    const ranks = ranksFor(rows, strat, weight);
    return {
      recall: { 1: recallAt(ranks, rows, 1), 3: recallAt(ranks, rows, 3), 5: recallAt(ranks, rows, 5) },
      precision: { 3: precisionAt(ranks, rows, 3) },
      ndcg: { 5: ndcgAt(ranks, rows, 5) },
      mrr: mrr(ranks, rows)
    };
  };
  const kindMetric = (rows: QueryEval[], strat: Strategy): KindMetrics => {
    const ranks = ranksFor(rows, strat, weight);
    return { r1: recallAt(ranks, rows, 1), mrr: mrr(ranks, rows) };
  };

  const strategies = ["keyword", "semantic", "hybrid", "hybrid+rerank"] as const;
  // Whole-set slices, kept only for continuity with numbers published before 2026-08-05. The gate
  // scores the held-out slices below; these four rows used to feed it, which leaked the 30 tuning
  // queries that selected the blend weight into four of six gate rows.
  const exactAll = evals.filter((e) => e.kind === "exact");
  const paraAll = evals.filter((e) => e.kind === "paraphrase");

  const regressions: Regression[] = [];
  const hybridRanks = ranksFor(evals, "hybrid", weight);
  const rerankRanks = ranksFor(evals, "hybrid+rerank", weight);
  
  for (let i = 0; i < evals.length; i++) {
    const q = evals[i];
    const hr = hybridRanks[i][0] ?? null;
    const rr = rerankRanks[i][0] ?? null;
    
    if (hr !== null && (rr === null || rr > hr)) {
      const targetDocId = q.relevant.find(id => hybridDocs(q, weight).indexOf(id) === hr - 1) ?? q.relevant[0];
      const targetFilename = corpus.find(c => idByFile.get(c.fileName) === targetDocId)?.fileName ?? "unknown";
      
      const chunkToDoc = new Map<string, string>();
      for (const c of [...q.kw, ...q.sm]) chunkToDoc.set(c.chunkId, c.docId);
      
      const toScored = (h: ChunkHit[]) => h.map(x => ({ id: x.chunkId, score: x.score }));
      const blended = blendHybrid(toScored(q.kw), toScored(q.sm), weight);
      
      const bestChunkId = blended.find(b => chunkToDoc.get(b.id) === targetDocId)?.id;
      const kwScore = q.kw.find(x => x.chunkId === bestChunkId)?.score ?? 0;
      const smScore = q.sm.find(x => x.chunkId === bestChunkId)?.score ?? 0;
      const rerankScore = (bestChunkId && q.rerankScores) ? (q.rerankScores[bestChunkId] ?? null) : null;
      
      let likelyReason = "Unknown";
      if (rerankScore === null) likelyReason = "Target chunk truncated/not passed to reranker";
      else if (rr === null) likelyReason = "Reranker completely buried the document";
      else likelyReason = "Reranker preferred another document more";
      
      regressions.push({
        query: q.queryText,
        expectedDoc: targetFilename,
        hybridRank: hr,
        rerankRank: rr,
        kwScore,
        smScore,
        rerankerScore: rerankScore,
        likelyReason
      });
    }
  }

  // Per-query scores on the held-out split, for the bootstrap. Unanswerable queries are dropped
  // rather than contributing a zero, so the interval is around the same quantity the point
  // estimate reports.
  const headlineRows = testRows.length > 0 ? testRows : evals;
  const judgedIdx = headlineRows
    .map((r, i) => (r.relevant.length > 0 ? i : -1))
    .filter((i) => i >= 0);
  const headlineRanks = ranksFor(headlineRows, "hybrid", weight);
  const reciprocalRanks = judgedIdx.map((i) =>
    headlineRanks[i].length > 0 ? 1 / headlineRanks[i][0] : 0,
  );
  const hitAt = (k: number) =>
    judgedIdx.map(
      (i) => headlineRanks[i].filter((x) => x <= k).length / headlineRows[i].relevant.length,
    );

  // Rejection: can a leg's raw top score separate an unanswerable query from an answerable one?
  // Hybrid is deliberately absent — blendHybrid min-max normalises per query, so its top score is
  // 1.0 for every query and carries no absolute information at all.
  const topsFor = (leg: "kw" | "sm") =>
    headlineRows.map((r) => ({
      top: (leg === "kw" ? r.kw : r.sm)[0]?.score ?? 0,
      answerable: r.relevant.length > 0,
    }));
  const numUnanswerable = headlineRows.length - judgedIdx.length;
  // Held-out slices by kind — what the gate scores from now on.
  const exact = headlineRows.filter((e) => e.kind === "exact");
  const para = headlineRows.filter((e) => e.kind === "paraphrase");

  // Per-query reciprocal rank on the judged held-out queries, per strategy. Indexed identically
  // across strategies, which is what makes the paired bootstrap below valid.
  const perQueryRR = (strat: Strategy): number[] => {
    const rk = ranksFor(headlineRows, strat, weight);
    return judgedIdx.map((i) => (rk[i].length > 0 ? 1 / rk[i][0] : 0));
  };
  const perQueryHit = (strat: Strategy, k: number): number[] => {
    const rk = ranksFor(headlineRows, strat, weight);
    return judgedIdx.map(
      (i) => rk[i].filter((x) => x <= k).length / headlineRows[i].relevant.length,
    );
  };
  const rrByStrategy = Object.fromEntries(strategies.map((s) => [s, perQueryRR(s)])) as Record<
    Strategy,
    number[]
  >;

  // Every ordered pair, better-first, so a positive delta always reads as "a beats b".
  const deltas: StrategyDelta[] = [];
  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      const [a, b] = [strategies[i], strategies[j]];
      const d = bootstrapDelta(rrByStrategy[a], rrByStrategy[b], BOOTSTRAP_SAMPLES);
      deltas.push(d.value >= 0 ? { a, b, delta: d } : {
        a: b,
        b: a,
        delta: { ...d, value: -d.value, lo: -d.hi, hi: -d.lo },
      });
    }
  }
  deltas.sort((x, y) => y.delta.value - x.delta.value);

  const rejection: RejectionReport = {
    numAnswerable: judgedIdx.length,
    numUnanswerable,
    legs: { keyword: rejectionSignal(topsFor("kw")), semantic: rejectionSignal(topsFor("sm")) },
    caveat:
      numUnanswerable <= 1
        ? `n=${numUnanswerable} unanswerable query in the held-out split and 0 in the tuning split. ` +
          `No rejection RATE is estimable from this, and no threshold can be calibrated without ` +
          `fitting it to the test set. Reported as score separation only.`
        : `${numUnanswerable} unanswerable queries. Threshold must be calibrated on the tuning split.`,
  };

  const report: EvalReport = {
    numQueries: evals.length,
    numDocs: corpus.length,
    hybridWeight: weight,
    depths: effectiveDepths,
    dataset: {
      version: DATASET_VERSION,
      queriesSha: sha8(queries),
      corpusSha: sha8(corpus),
      numQueries: evals.length,
      numTune: tuneRows.length,
      numTest: testRows.length,
      numTestJudged: judgedCount(headlineRows),
      numDocs: corpus.length,
    },
    ci: {
      mrr: Object.fromEntries(strategies.map((s) => [s, bootstrapCI(rrByStrategy[s], BOOTSTRAP_SAMPLES)])) as Record<Strategy, Interval>,
      r1: Object.fromEntries(strategies.map((s) => [s, bootstrapCI(perQueryHit(s, 1), BOOTSTRAP_SAMPLES)])) as Record<Strategy, Interval>,
      r5: Object.fromEntries(strategies.map((s) => [s, bootstrapCI(perQueryHit(s, 5), BOOTSTRAP_SAMPLES)])) as Record<Strategy, Interval>,
    },
    deltas,
    strategiesAll: Object.fromEntries(strategies.map((s) => [s, metricsFor(evals, s)])) as Record<
      Strategy,
      StrategyMetrics
    >,
    // Headline: held-out only.
    strategies: Object.fromEntries(strategies.map((s) => [s, metricsFor(headlineRows, s)])) as Record<
      Strategy,
      StrategyMetrics
    >,
    ceilings: {
      recall: {
        1: ceilingFor(headlineRows, "recall", 1),
        3: ceilingFor(headlineRows, "recall", 3),
        5: ceilingFor(headlineRows, "recall", 5),
      },
      precision: { 3: ceilingFor(headlineRows, "precision", 3) },
      ndcg: { 5: ceilingFor(headlineRows, "ndcg", 5) },
      mrr: ceilingFor(headlineRows, "mrr"),
    },
    hitRate: Object.fromEntries(
      strategies.map((st) => {
        const rk = ranksFor(headlineRows, st, weight);
        return [st, { 1: hitRateAt(rk, headlineRows, 1), 3: hitRateAt(rk, headlineRows, 3), 5: hitRateAt(rk, headlineRows, 5) }];
      }),
    ) as Record<Strategy, { 1: number; 3: number; 5: number }>,
    rejection,
    byKind: {
      exact: Object.fromEntries(strategies.map((s) => [s, kindMetric(exact, s)])) as Record<Strategy, KindMetrics>,
      paraphrase: Object.fromEntries(strategies.map((s) => [s, kindMetric(para, s)])) as Record<Strategy, KindMetrics>,
    },
    byKindAll: {
      exact: Object.fromEntries(strategies.map((s) => [s, kindMetric(exactAll, s)])) as Record<Strategy, KindMetrics>,
      paraphrase: Object.fromEntries(strategies.map((s) => [s, kindMetric(paraAll, s)])) as Record<Strategy, KindMetrics>,
    },
    sweep,
    regressions,
    gate: [],
    passed: true,
  };

  // Quality gate. Every row is now scored on the HELD-OUT split: `byKind` used to be computed
  // over tune+test, so four of these six rows included the 30 queries that chose the blend weight.
  // Floors sit below current numbers to catch regressions,
  // not variance — so a pass means "has not regressed", never "meets an external bar".
  //
  // The gate used to assert "hybrid MRR ≥ best single strategy". That was removed, not relaxed:
  // held-out evaluation showed it is false on this corpus. Hybrid wins on exact-match queries and
  // loses on paraphrases by more, so semantic alone scores higher overall. Keeping a gate that
  // encodes a claim the data contradicts would make CI enforce a fiction. What replaces it is the
  // property hybrid genuinely has: it is the strongest configuration for exact-match queries,
  // while not collapsing on paraphrases.
  const gate: GateRow[] = [
    g("keyword R@1 on exact", report.byKind.exact.keyword.r1, 0.5),
    g("semantic R@1 on paraphrase", report.byKind.paraphrase.semantic.r1, 0.7),
    g("semantic MRR overall", report.strategies.semantic.mrr, 0.85),
    g("hybrid R@5 overall", report.strategies.hybrid.recall[5], 0.9),
    g("hybrid best on exact queries", report.byKind.exact.hybrid.r1, 0.85),
    g("hybrid does not collapse on paraphrase", report.byKind.paraphrase.hybrid.mrr, 0.75),
  ];
  report.gate = gate;
  report.passed = gate.every((r) => r.pass);
  return report;
}

function g(name: string, value: number, floor: number): GateRow {
  return { name, value, floor, pass: value >= floor };
}
````

### `apps/web/eval/run.ts`

_193 lines_

````ts
/**
 * CLI entry point for the retrieval evaluation. Prints a comparison table + weight
 * sweep and exits non-zero if the quality gate fails (used as a CI check).
 *
 * Run: pnpm --filter @indexflow/web eval
 */
import { prisma } from "../lib/prisma";
import { EMBED_DIM, EMBED_MODEL } from "../lib/embed";
import { RERANK_MODEL } from "../lib/rerank";
import { runEvaluation, type EvalReport } from "./harness";

const pct = (n: number) => (n * 100).toFixed(0).padStart(3) + "%";
const f2 = (n: number) => n.toFixed(2);
const f4 = (n: number) => n.toFixed(4);

function print(r: EvalReport) {
  const strategies = ["keyword", "semantic", "hybrid", "hybrid+rerank"] as const;

  const iv = (i: { value: number; lo: number; hi: number }) =>
    `${pct(i.value).trim()} [${pct(i.lo).trim()}–${pct(i.hi).trim()}]`;

  console.log(`\nRetrieval eval — ${r.numQueries} queries over ${r.numDocs} docs`);
  console.log(
    `* Dataset ${r.dataset.version} (queries ${r.dataset.queriesSha}, corpus ${r.dataset.corpusSha})`,
  );
  console.log(
    `* Split: ${r.dataset.numTune} tuning (weight chosen here) / ${r.dataset.numTest} held-out (reported below)`,
  );
  console.log(
    `* Scored on ${r.dataset.numTestJudged} of ${r.dataset.numTest} held-out queries — ` +
      `${r.dataset.numTest - r.dataset.numTestJudged} has no relevant document and is excluded ` +
      `from every ranking metric (measured separately below)`,
  );
  // Read the model names from the code that actually runs, never a hardcoded string —
  // a stale literal here silently mislabels every captured result.
  console.log(`* Chunking: semantic chunker`);
  console.log(`* Embedding: ${EMBED_MODEL} (${EMBED_DIM}-dim)`);
  console.log(`* Reranker: ${RERANK_MODEL}`);
  // Read from the report, never a literal. This line used to claim "10 chunks per strategy"
  // while the keyword leg retrieved every chunk in the corpus.
  console.log(
    `* Initial retrieval: keyword ${r.depths.keyword} / semantic ${r.depths.semantic} chunks ` +
      `(production CANDIDATE_LIMIT, clamped to corpus size)`,
  );
  console.log(`* Reranker input: Top 10 blended chunks`);
  
  console.log("─".repeat(80));
  console.log("Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5");
  console.log("─".repeat(80));
  for (const s of strategies) {
    const m = r.strategies[s];
    const row = [m.recall[1], m.recall[3], m.recall[5], m.precision[3], m.ndcg[5]].map(pct).join("   ");
    console.log(`${s.padEnd(15)}  ${f2(m.mrr)}   ${row}`);
  }

  // The ceiling is printed permanently, not as a one-off analysis. A metric whose attainable
  // maximum is below 1 is unreadable without it: P@3 = 36% looks like a poor precision until you
  // can see that 37% is everything the label density allows.
  const c = r.ceilings;
  const ceilRow = [c.recall[1], c.recall[3], c.recall[5], c.precision[3], c.ndcg[5]]
    .map(pct)
    .join("   ");
  console.log(`${"ceiling".padEnd(15)}  ${f2(c.mrr)}   ${ceilRow}`);
  console.log("─".repeat(80));
  console.log("as % of attainable ceiling:");
  for (const s of strategies) {
    const m = r.strategies[s];
    const of = (v: number, ceil: number) => pct(ceil === 0 ? 0 : v / ceil);
    const row = [
      of(m.recall[1], c.recall[1]),
      of(m.recall[3], c.recall[3]),
      of(m.recall[5], c.recall[5]),
      of(m.precision[3], c.precision[3]),
      of(m.ndcg[5], c.ndcg[5]),
    ].join("   ");
    console.log(`${s.padEnd(15)} ${of(m.mrr, c.mrr)}   ${row}`);
  }
  console.log("─".repeat(80));
  // R@1 is a recall and is capped below 1 by multi-relevant queries. Hit rate is the metric a
  // reader assumes R@1 to be: "the right answer was in the top k".
  console.log("hit rate — share of queries with ANY relevant document in the top k:");
  for (const s of strategies) {
    const hr = r.hitRate[s];
    console.log(`  ${s.padEnd(15)} HR@1 ${pct(hr[1])}   HR@3 ${pct(hr[3])}   HR@5 ${pct(hr[5])}`);
  }
  console.log("  (a perfect ranker scores 100% here; its R@1 on this label set is capped at 94%)");
  console.log("─".repeat(80));
  console.log("95% MARGINAL bootstrap intervals (held-out):");
  for (const s of strategies) {
    console.log(
      `  ${s.padEnd(15)} MRR ${iv(r.ci.mrr[s]).padEnd(18)} R@1 ${iv(r.ci.r1[s]).padEnd(18)} R@5 ${iv(r.ci.r5[s])}`,
    );
  }
  console.log("");
  console.log("95% PAIRED bootstrap intervals on the per-query MRR difference (held-out):");
  console.log("  Marginal intervals above CANNOT settle 'is A better than B' — the strategies are");
  console.log("  scored on the same queries, so the comparison is paired. Overlapping marginal");
  console.log("  intervals do not imply an insignificant difference.");
  for (const d of r.deltas) {
    const sig = d.delta.excludesZero ? "SIGNIFICANT" : "not significant";
    console.log(
      `  Δ MRR ${(d.a + " − " + d.b).padEnd(31)} ${d.delta.value >= 0 ? "+" : ""}${f2(d.delta.value)} ` +
        `[${f2(d.delta.lo)}, ${f2(d.delta.hi)}]   excludes zero: ${d.delta.excludesZero ? "yes" : "no "}   ${sig}`,
    );
  }
  console.log("─".repeat(80));
  const rj = r.rejection;
  console.log(
    `rejection — ${rj.numUnanswerable} unanswerable / ${rj.numAnswerable} answerable held-out queries:`,
  );
  for (const leg of ["keyword", "semantic"] as const) {
    const s = rj.legs[leg];
    const tops = s.unanswerableTop.map((v) => v.toFixed(3)).join(", ") || "—";
    console.log(
      `  ${leg.padEnd(9)} unanswerable top ${tops}   ` +
        `answerable top min ${s.answerableTop.min.toFixed(3)} / med ${s.answerableTop.median.toFixed(3)} / max ${s.answerableTop.max.toFixed(3)}   ` +
        `${s.separable ? "separable" : "NOT separable"}`,
    );
  }
  console.log(`  hybrid    not measurable — min-max normalisation puts every query's top at 1.000`);
  console.log(`  ${rj.caveat}`);
  console.log("─".repeat(80));
  console.log("by query kind (R@1 / MRR), HELD-OUT — this is what the gate scores:");
  console.log("            keyword        semantic       hybrid         hybrid+rerank");
  for (const kind of ["exact", "paraphrase"] as const) {
    const cells = strategies
      .map((s) => `${pct(r.byKind[kind][s].r1)} / ${f2(r.byKind[kind][s].mrr)}`.padStart(15))
      .join("");
    console.log(`${kind.padEnd(12)}${cells}`);
  }
  console.log("");
  console.log("same, whole set (tune+test) — for continuity with numbers published before 2026-08-05:");
  for (const kind of ["exact", "paraphrase"] as const) {
    const cells = strategies
      .map((s) => `${pct(r.byKindAll[kind][s].r1)} / ${f2(r.byKindAll[kind][s].mrr)}`.padStart(15))
      .join("");
    console.log(`${kind.padEnd(12)}${cells}`);
  }
  console.log("─".repeat(80));
  console.log(`hybrid weight sweep on the TUNING split (keyword weight → MRR), best = ${f2(r.hybridWeight)}:`);
  // 4dp, so a reader can see whether the plateau is genuinely flat or an artifact of rounding
  // against the `bestScore - 1e-9` tie-break. At 2dp a 0.0004 difference is invisible and the
  // tie-break silently decides the weight.
  console.log(
    r.sweep
      .map((s) => `${f2(s.weight)}:${f4(s.mrr)}${s.weight === r.hybridWeight ? "*" : " "}`)
      .join("  "),
  );
  const bestMrr = Math.max(...r.sweep.map((s) => s.mrr));
  const plateau = r.sweep.filter((s) => s.mrr >= bestMrr - 1e-9);
  console.log(
    `  plateau: ${plateau.length} of ${r.sweep.length} weights within 1e-9 of the maximum` +
      (plateau.length > 1
        ? ` (${f2(plateau[0].weight)}\u2013${f2(plateau[plateau.length - 1].weight)}) \u2014 the tie-break picks its centre`
        : ""),
  );
  console.log("─".repeat(80));
  
  if (r.regressions && r.regressions.length > 0) {
    console.log(`Reranker Regressions (${r.regressions.length} queries):`);
    for (const reg of r.regressions) {
      console.log(`  Query: "${reg.query}"`);
      console.log(`  Expected: ${reg.expectedDoc}`);
      console.log(`  Ranks: Hybrid #${reg.hybridRank} -> Reranked #${reg.rerankRank ?? "Dropped"}`);
      console.log(`  Scores: KW=${f2(reg.kwScore)} / SM=${f2(reg.smScore)} / Rerank=${reg.rerankerScore !== null ? f2(reg.rerankerScore) : "N/A"}`);
      console.log(`  Analysis: ${reg.likelyReason}\n`);
    }
    console.log("─".repeat(80));
  }

  console.log("quality gate:");
  for (const row of r.gate) {
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name}: ${pct(row.value)} (floor ${pct(row.floor)})`);
  }
  console.log("─".repeat(80));
}

runEvaluation()
  .then(async (report) => {
    print(report);
    await prisma.$disconnect();
    if (report.passed) {
      console.log("\nQuality gate passed. ✓");
    } else {
      console.error("\nQuality gate FAILED — retrieval regressed below floor.");
      process.exitCode = 1;
    }
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
````

### 2.6 Permission-leak eval

### `apps/web/eval/acl-leak.ts`

_235 lines_

````ts
/**
 * Permission-aware search — the leak test (the security proof for permission-aware RAG).
 *
 * It drives the REAL retrieval + answer path (lib/retrieve, lib/rag — the exact code the
 * search and answer routes call), not a reimplementation. It seeds a few users, a group,
 * and documents with different ACLs into the live Postgres + Elasticsearch, then asserts:
 *
 *   1. A viewer only ever RETRIEVES chunks they can see — on the keyword leg, the semantic
 *      leg, and the blended hybrid path — even when a restricted document is the single
 *      most relevant match for the query.
 *   2. Positive controls: the owner (and a granted group member) DO retrieve the doc, so
 *      the filter isn't just hiding everything.
 *   3. A generated RAG answer for a restricted query never contains the restricted secret
 *      (transitively guaranteed by (1), and checked directly when Ollama is reachable).
 *
 * Everything it creates is torn down in a finally block. Exits non-zero on any leak.
 * Run: pnpm --filter @indexflow/web acl:leak
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { embed, toVectorLiteral } from "../lib/embed";
import { aclTokens, viewerFrom, type Viewer } from "../lib/acl";
import { ensureChunkIndex, indexChunks, deleteDocumentChunks, type EsChunk } from "../lib/es";
import { fetchKeyword, fetchSemantic, retrieveContexts } from "../lib/retrieve";
import { answerQuestion } from "../lib/rag";

const TAG = "[acl-leak]"; // titles are tagged so any orphan is obvious + easy to purge

interface SeededDoc {
  id: string;
  chunkId: string;
  title: string;
}

// Create a document with real chunk embeddings in Postgres and a matching, ACL-tagged
// chunk in Elasticsearch — the same dual-write the ingest path performs.
async function seedDoc(opts: {
  title: string;
  content: string;
  isPublic: boolean;
  ownerId: string | null;
  grantGroupId?: string;
  grantUserId?: string;
}): Promise<SeededDoc> {
  const doc = await prisma.document.create({
    data: {
      title: opts.title,
      fileName: `${opts.title}.md`,
      fileType: "md",
      status: "INDEXED",
      indexedAt: new Date(),
      isPublic: opts.isPublic,
      ownerId: opts.ownerId,
      grants: {
        create: [
          ...(opts.grantGroupId ? [{ groupId: opts.grantGroupId }] : []),
          ...(opts.grantUserId ? [{ userId: opts.grantUserId }] : []),
        ],
      },
    },
    select: { id: true, isPublic: true, ownerId: true, grants: { select: { userId: true, groupId: true } } },
  });

  const [vec] = await embed([opts.content]);
  const chunkId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
    VALUES (${chunkId}::uuid, ${doc.id}::uuid, 0, ${opts.content}, ${Math.ceil(opts.content.length / 4)},
            ${toVectorLiteral(vec)}::vector, now())
  `;

  const esChunk: EsChunk = {
    chunkId,
    documentId: doc.id,
    chunkIndex: 0,
    title: opts.title,
    fileType: "md",
    content: opts.content,
    acl: aclTokens(doc),
  };
  await indexChunks([esChunk], undefined, "wait_for");
  return { id: doc.id, chunkId, title: opts.title };
}

// ── Assertion plumbing ──
let failures = 0;
function check(pass: boolean, label: string) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}

async function retrievedDocIds(query: string, viewer: Viewer): Promise<Set<string>> {
  // Exercise each leg independently AND the blended path — a leak on any is a failure.
  const [kw, sm, hybrid] = await Promise.all([
    fetchKeyword(query, null, viewer),
    fetchSemantic(query, null, viewer),
    retrieveContexts(query, 6, viewer),
  ]);
  return new Set<string>([
    ...kw.map((c) => c.documentId),
    ...sm.map((c) => c.documentId),
    ...hybrid.map((c) => c.documentId),
  ]);
}

async function main() {
  await ensureChunkIndex();

  // ── Seed identities ──
  const alice = await prisma.user.create({ data: { name: `${TAG} Alice`, email: `${randomUUID()}@acl.test` } });
  const bob = await prisma.user.create({ data: { name: `${TAG} Bob`, email: `${randomUUID()}@acl.test` } });
  const carol = await prisma.user.create({ data: { name: `${TAG} Carol`, email: `${randomUUID()}@acl.test` } });
  const eng = await prisma.group.create({ data: { name: `${TAG} engineering ${randomUUID().slice(0, 8)}` } });
  // Alice and Carol are in engineering; Bob is not.
  await prisma.groupMember.createMany({
    data: [
      { userId: alice.id, groupId: eng.id },
      { userId: carol.id, groupId: eng.id },
    ],
  });

  const SECRET = "codename BLUEBIRD, target Acme Corp";
  const docs: SeededDoc[] = [];
  // Track each doc as it is created (not after all three) so a mid-seed failure still
  // tears down whatever was already written to Postgres + Elasticsearch.
  const seed = async (opts: Parameters<typeof seedDoc>[0]): Promise<SeededDoc> => {
    const d = await seedDoc(opts);
    docs.push(d);
    return d;
  };
  try {
    // ── Seed documents with distinct ACLs ──
    const handbook = await seed({
      title: `${TAG} Public Handbook`,
      content: "The company handbook covers general onboarding, PTO requests, and office locations.",
      isPublic: true,
      ownerId: null,
    });
    // Bob's private doc — crafted to be THE most relevant match for the secret query.
    const bobSecret = await seed({
      title: `${TAG} Acquisition Memo`,
      content: `Confidential M&A memo: the Q3 acquisition ${SECRET}. Do not distribute.`,
      isPublic: false,
      ownerId: bob.id,
    });
    // Engineering-only doc, owned by Carol, shared with the engineering group.
    const engRoadmap = await seed({
      title: `${TAG} Engineering Roadmap`,
      content: "Engineering roadmap: migrate the search index to shards and add a cross-encoder reranker in Q4.",
      isPublic: false,
      ownerId: carol.id,
      grantGroupId: eng.id,
    });

    const vAlice = await viewerFrom(alice.id);
    const vBob = await viewerFrom(bob.id);
    const vAnon = await viewerFrom(null);

    const secretQuery = "What is the Q3 acquisition target and codename?";
    const engQuery = "What is on the engineering roadmap for Q4?";

    console.log(`\n${TAG} retrieval leak checks`);
    console.log("─".repeat(60));

    // (1) The core leak assertions — Alice must never retrieve Bob's private memo,
    // even though it is the most relevant document for this query.
    const aliceOnSecret = await retrievedDocIds(secretQuery, vAlice);
    check(!aliceOnSecret.has(bobSecret.id), "Alice does NOT retrieve Bob's private memo (keyword+semantic+hybrid)");

    // Anonymous sees only public.
    const anonOnSecret = await retrievedDocIds(secretQuery, vAnon);
    check(!anonOnSecret.has(bobSecret.id), "Anonymous does NOT retrieve Bob's private memo");
    check(!anonOnSecret.has(engRoadmap.id), "Anonymous does NOT retrieve the engineering-only doc");

    // Group grant: Bob (not in engineering) must not see the roadmap; Alice (in it) must.
    const bobOnEng = await retrievedDocIds(engQuery, vBob);
    check(!bobOnEng.has(engRoadmap.id), "Bob (not in group) does NOT retrieve the engineering-only doc");
    const aliceOnEng = await retrievedDocIds(engQuery, vAlice);
    check(aliceOnEng.has(engRoadmap.id), "Alice (group member) DOES retrieve the engineering-only doc [positive control]");

    // (2) Positive control: Bob CAN retrieve his own private memo.
    const bobOnSecret = await retrievedDocIds(secretQuery, vBob);
    check(bobOnSecret.has(bobSecret.id), "Bob DOES retrieve his own private memo [positive control]");

    // (2b) Per-leg control on the KEYWORD leg specifically. The leak assertions above run on
    // the union of legs, so a silently-empty keyword leg (e.g. the `acl` field mis-mapped as
    // `text` instead of `keyword`, which makes the `terms` filter match nothing) would still
    // "pass" — the semantic leg alone would carry them. Proving the keyword leg both admits
    // (Bob) and blocks (Alice) its own ACL guarantees it is actually enforcing, not just off.
    const kwBob = new Set((await fetchKeyword(secretQuery, null, vBob)).map((c) => c.documentId));
    check(kwBob.has(bobSecret.id), "Keyword leg returns Bob's memo for Bob [keyword ACL admits; leg is live]");
    const kwAlice = new Set((await fetchKeyword(secretQuery, null, vAlice)).map((c) => c.documentId));
    check(!kwAlice.has(bobSecret.id), "Keyword leg excludes Bob's memo for Alice [keyword ACL blocks]");

    // (3) Generation leak: Alice's RAG answer must not contain Bob's secret. Skipped if
    // Ollama is unreachable — the retrieval assertions above already guarantee it, since
    // the generator can only cite chunks the retriever returned.
    console.log(`\n${TAG} generation leak check`);
    console.log("─".repeat(60));
    try {
      const { answer } = await answerQuestion(secretQuery, vAlice);
      let text = "";
      if (answer) for await (const ev of answer) if (ev.type === "delta") text += ev.text;
      const leaked = /bluebird/i.test(text) || /acme corp/i.test(text);
      check(!leaked, "Alice's generated answer does NOT contain Bob's secret");
      console.log(`      answer: ${JSON.stringify(text.slice(0, 140))}`);
    } catch (e) {
      console.log(`  SKIP  generation check (Ollama unreachable: ${e instanceof Error ? e.message : e})`);
    }
  } finally {
    // ── Teardown: remove everything this test created (PG cascade + ES) ──
    for (const d of docs) {
      await deleteDocumentChunks(d.id, undefined, true).catch(() => {});
      await prisma.document.delete({ where: { id: d.id } }).catch(() => {}); // cascades chunks + grants
    }
    await prisma.group.delete({ where: { id: eng.id } }).catch(() => {}); // cascades members
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id] } } }).catch(() => {});
  }

  console.log("─".repeat(60));
  if (failures === 0) {
    console.log("No permission leaks. ✓");
  } else {
    console.error(`${failures} permission leak(s) detected. ✗`);
    process.exitCode = 1;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
````

### 2.7 CI workflows

All three files in `.github/workflows/`.

### `.github/workflows/ci.yml`

_663 lines_

````yaml
name: CI

on:
  pull_request:
    branches: [main]
  # Lets the evaluation jobs be run against a branch without opening a PR first — the
  # cross-check and the eval harness need Linux services that a Mac dev box may not have.
  #
  # The heavy benchmarks are opt-in and mutually exclusive. Dispatching several at once left most
  # of them queued until GitHub cancelled them at the 15-minute mark, twice, taking trivial jobs
  # down with them — only a few run concurrently, so they starve each other. One per dispatch.
  workflow_dispatch:
    inputs:
      benchmark:
        description: "Heavy benchmark to run (none = gating jobs only)"
        type: choice
        options: [none, scale-beir, latency, ingestion, scale-curve]
        default: none
      beir_subset:
        description: "BEIR subset (scale-beir only)"
        type: choice
        options: [scifact, nfcorpus]
        default: scifact

jobs:
  build:
    name: build
    runs-on: ubuntu-latest
    env:
      # Build never connects to the DB, but Prisma + Next want the var present.
      DATABASE_URL: postgresql://indexflow:indexflow@localhost:5432/indexflow?schema=public
      # Auth.js reads its secret lazily at request time, but set a dummy so the build
      # is deterministic. No real Google creds needed to compile.
      AUTH_SECRET: ci-build-only-not-a-real-secret
    steps:
      - uses: actions/checkout@v4

      # Version comes from `packageManager` in the root package.json — specifying it here too
      # makes the action fail with a version conflict.
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @indexflow/web prisma generate

      - name: Build (type-checks)
        run: pnpm --filter @indexflow/web build

  unit:
    name: unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Version comes from `packageManager` in the root package.json — specifying it here too
      # makes the action fail with a version conflict.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      # Pure logic, no services — fast enough to be the first thing that fails.
      - name: Run unit tests
        run: pnpm --filter @indexflow/web test:unit

  # The metric functions are from-scratch and decide whether the eval gate passes, so they are
  # scored against NIST trec_eval (via pytrec_eval) on rankings whose values are known on paper.
  # A C extension, so it cannot build on a dev Mac without Xcode — this job is where it runs.
  metrics:
    name: metrics cross-check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      # `python3 -m pip`, and the checker invoked as a plain step rather than through the pnpm
      # script: pnpm resolved a different interpreter from the one pip installed into, so the
      # module was missing at import despite a successful install.
      # pytrec-eval-terrier is the maintained fork; the original pytrec_eval 0.5 sdist builds a
      # wheel on 3.12 but the extension does not then import. Module name is the same.
      - name: Install pytrec_eval
        run: python3 -m pip install pytrec-eval-terrier
      - name: Show what was installed
        run: |
          python3 -m pip show -f pytrec-eval-terrier || true
          python3 -c "import pytrec_eval, inspect; print('import ok:', pytrec_eval.__file__)" || true
      - name: Export rankings in TREC format
        run: pnpm --filter @indexflow/web eval:trec-export
      - name: Cross-check metrics against the reference implementation
        run: python3 apps/web/eval/crosscheck.py apps/web/.evalrun/trec
      - name: Upload TREC export
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: trec-export
          path: apps/web/.evalrun/trec/
  container:
    name: container build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      # Both images must keep building. The worker is a separate target because Next's standalone
      # output does not include its dependencies, and a broken worker image would otherwise only
      # be discovered at deploy time.
      - name: Build web image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/Dockerfile
          target: runner
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build worker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/Dockerfile
          target: worker
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max

  eval:
    name: eval
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: indexflow
          POSTGRES_PASSWORD: indexflow
          POSTGRES_DB: indexflow
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U indexflow -d indexflow"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
        env:
          discovery.type: single-node
          xpack.security.enabled: "false"
          ES_JAVA_OPTS: "-Xms512m -Xmx512m"
          ingest.geoip.downloader.enabled: "false"
        ports:
          - 9200:9200
    env:
      DATABASE_URL: postgresql://indexflow:indexflow@localhost:5432/indexflow?schema=public
      ES_URL: http://localhost:9200
      # The consistency check drives the REAL ingest path, which reads the original file back
      # out of object storage — so it needs MinIO, not just Postgres and Elasticsearch.
      MINIO_ENDPOINT: http://localhost:9100
      MINIO_ACCESS_KEY: indexflow
      MINIO_SECRET_KEY: indexflow123
      MINIO_BUCKET: indexflow
    steps:
      - uses: actions/checkout@v4

      # Version comes from `packageManager` in the root package.json — specifying it here too
      # makes the action fail with a version conflict.
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # Not a `services:` entry: GitHub Actions cannot override a service container's command,
      # and minio/minio needs `server /data`. The bucket is created on first write by
      # lib/storage ensureBucket().
      - name: Start MinIO
        run: |
          docker run -d --name minio -p 9100:9000 \
            -e MINIO_ROOT_USER=indexflow -e MINIO_ROOT_PASSWORD=indexflow123 \
            minio/minio:latest server /data
          for i in $(seq 1 30); do
            if curl -sf "http://localhost:9100/minio/health/live" >/dev/null; then
              echo "MinIO is up."; exit 0
            fi
            sleep 2
          done
          echo "MinIO did not become ready in time." >&2
          docker logs minio >&2 || true
          exit 1

      # The eval/backfill scripts load apps/web/.env via --env-file; create it in CI.
      - name: Write env file
        run: |
          {
            echo "DATABASE_URL=${DATABASE_URL}"
            echo "ES_URL=${ES_URL}"
            echo "MINIO_ENDPOINT=${MINIO_ENDPOINT}"
            echo "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}"
            echo "MINIO_SECRET_KEY=${MINIO_SECRET_KEY}"
            echo "MINIO_BUCKET=${MINIO_BUCKET}"
          } > apps/web/.env

      - name: Apply migrations
        run: pnpm --filter @indexflow/web prisma migrate deploy

      # ES image ships without curl, so wait from the runner instead of a container healthcheck.
      - name: Wait for Elasticsearch
        run: |
          for i in $(seq 1 60); do
            if curl -sf "${ES_URL}/_cluster/health?wait_for_status=yellow&timeout=5s" >/dev/null; then
              echo "Elasticsearch is up."; exit 0
            fi
            sleep 3
          done
          echo "Elasticsearch did not become ready in time." >&2; exit 1

      # Phase 3: reports the depth matrix on the TUNING split only, so it cannot leak into the
      # held-out numbers the gate below scores. Informational — it has no gate of its own.
      - name: Retrieval depth matrix (tuning split)
        run: pnpm --filter @indexflow/web eval:depth

      - name: Run retrieval evaluation (quality gate)
        run: pnpm --filter @indexflow/web eval

      # Security regression gate. Needs only Postgres; the live-HTTP layer skips itself when no
      # server is running, and the authorization gate it checks is the part that must not regress.
      - name: Run direct-object-access checks
        run: pnpm --filter @indexflow/web acl:dao

      # The permission leak test is the single most valuable check in the repository and was
      # on-demand only: a retrieval regression failed the build, an ACL regression did not, on a
      # project whose central claim is permission-awareness. Its generation-layer assertion needs
      # Ollama and skips loudly here; the eight retrieval-leg assertions — including the positive
      # controls that stop it passing because retrieval is simply broken — all run.
      - name: Run permission leak checks
        run: pnpm --filter @indexflow/web acl:leak

      - name: Run sharing lifecycle checks
        run: pnpm --filter @indexflow/web acl:sharing

      # Cross-store consistency gate: proves a revoke racing an in-flight index is not lost, that
      # an unprojected document never reads as INDEXED, and that reconciliation repairs drift.
      - name: Run cross-store consistency checks
        run: pnpm --filter @indexflow/web consistency:check

      # The security + consistency regression suite. Every case in it corresponds to a defect
      # that actually shipped, so a red test here means a real vulnerability came back.
      - name: Run integration tests
        run: pnpm --filter @indexflow/web test:integration

      - name: Install Playwright browser
        run: pnpm --filter @indexflow/web exec playwright install chromium --with-deps

      # The principal workflow in a real browser: middleware, session cookies, API routes and UI
      # all have to agree. Playwright builds and starts the app itself (see playwright.config.ts).
      - name: Run end-to-end tests
        run: pnpm --filter @indexflow/web test:e2e
        env:
          AUTH_SECRET: e2e-only-not-a-real-secret

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/web/playwright-report/
          retention-days: 7

  scale:
    name: scale eval (BEIR)
    if: inputs.benchmark == 'scale-beir'
    runs-on: ubuntu-latest
    timeout-minutes: 90
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: indexflow
          POSTGRES_PASSWORD: indexflow
          POSTGRES_DB: indexflow
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U indexflow -d indexflow"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
        env:
          discovery.type: single-node
          xpack.security.enabled: "false"
          ES_JAVA_OPTS: "-Xms1g -Xmx1g"
          ingest.geoip.downloader.enabled: "false"
        ports:
          - 9200:9200
    env:
      DATABASE_URL: postgresql://indexflow:indexflow@localhost:5432/indexflow?schema=public
      ES_URL: http://localhost:9200
      BEIR_SUBSET: ${{ inputs.beir_subset }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      # Keyed on the subset name: the archive is hash-pinned in eval/beir.ts, so a cache hit can
      # never silently substitute different data.
      - name: Cache BEIR archives
        uses: actions/cache@v4
        with:
          path: apps/web/.evalrun/beir
          key: beir-${{ env.BEIR_SUBSET }}-v1
      - name: Write env file
        run: |
          {
            echo "DATABASE_URL=${DATABASE_URL}"
            echo "ES_URL=${ES_URL}"
          } > apps/web/.env
      - name: Apply migrations
        run: pnpm --filter @indexflow/web prisma migrate deploy
      - name: Wait for Elasticsearch
        run: |
          for i in $(seq 1 60); do
            if curl -fsS http://localhost:9200 >/dev/null 2>&1; then echo "ES up"; exit 0; fi
            sleep 5
          done
          echo "Elasticsearch did not become ready"; exit 1
      - name: Scale evaluation
        run: pnpm --filter @indexflow/web eval:scale

  # Phase 9b: latency at scale. Dispatch-only — it loads up to 50k synthetic vectors per scale and
  # runs three independent repeats, which is minutes, not seconds. Informational, no gate.

  bench:
    name: latency bench
    if: inputs.benchmark == 'latency'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: indexflow
          POSTGRES_PASSWORD: indexflow
          POSTGRES_DB: indexflow
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U indexflow -d indexflow"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
        env:
          discovery.type: single-node
          xpack.security.enabled: "false"
          ES_JAVA_OPTS: "-Xms1g -Xmx1g"
          ingest.geoip.downloader.enabled: "false"
        ports:
          - 9200:9200
    env:
      DATABASE_URL: postgresql://indexflow:indexflow@localhost:5432/indexflow?schema=public
      ES_URL: http://localhost:9200
      BENCH_SCALES: "1000,10000,50000"
      BENCH_QUERIES: "150"
      BENCH_REPEATS: "3"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Write env file
        run: |
          {
            echo "DATABASE_URL=${DATABASE_URL}"
            echo "ES_URL=${ES_URL}"
          } > apps/web/.env
      - name: Apply migrations
        run: pnpm --filter @indexflow/web prisma migrate deploy
      - name: Wait for Elasticsearch
        run: |
          for i in $(seq 1 60); do
            if curl -fsS http://localhost:9200 >/dev/null 2>&1; then echo "ES up"; exit 0; fi
            sleep 5
          done
          echo "Elasticsearch did not become ready"; exit 1
      - name: Latency benchmark
        run: pnpm --filter @indexflow/web bench:latency
      - name: Upload benchmark artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: latency-bench
          path: apps/web/.evalrun/

  # ── Phase 9a: quality vs corpus size, to 100k documents ──────────────────
  #
  # Embedding 152k chunks is ~2.7 hours on one runner — inside the 6-hour ceiling but with no
  # margin, and one hiccup wastes the lot. Sharded 12 ways it is ~14 minutes of wall clock, and a
  # failure costs one shard. Vectors move between jobs as float32 artifacts (234 MB total); as JSON
  # they would be roughly 3 GB.
  # One job warms the archive cache before the matrix starts. Twelve jobs fetching the same 70 MB
  # file from a university host at once got 2 of them refused on the first run; this is both more
  # reliable and better behaviour toward someone else's server.

  scale-curve-fetch:
    name: scale curve · fetch corpora
    if: inputs.benchmark == 'scale-curve'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Cache BEIR archives
        uses: actions/cache@v4
        with:
          path: apps/web/.evalrun/beir
          key: beir-scale-curve-v1
      - name: Write env file
        run: echo "DATABASE_URL=postgresql://unused" > apps/web/.env
      # Building the dataset forces both archives to be fetched and hash-verified.
      - name: Warm corpus cache
        run: SHARD_INDEX=0 SHARD_COUNT=100000 pnpm --filter @indexflow/web eval:embed-shard

  scale-curve-embed:
    name: scale curve · embed shard ${{ matrix.shard }}
    needs: scale-curve-fetch
    if: inputs.benchmark == 'scale-curve'
    runs-on: ubuntu-latest
    timeout-minutes: 90
    strategy:
      fail-fast: false
      matrix:
        shard: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    env:
      SHARD_INDEX: ${{ matrix.shard }}
      SHARD_COUNT: "12"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Cache BEIR archives
        uses: actions/cache@v4
        with:
          path: apps/web/.evalrun/beir
          key: beir-scale-curve-v1
      - name: Write env file
        run: echo "DATABASE_URL=postgresql://unused" > apps/web/.env
      - name: Embed shard
        run: pnpm --filter @indexflow/web eval:embed-shard
      - uses: actions/upload-artifact@v4
        with:
          name: curve-shard-${{ matrix.shard }}
          path: apps/web/.evalrun/shards/
          retention-days: 3

  scale-curve:
    name: scale curve · evaluate
    needs: scale-curve-embed
    if: inputs.benchmark == 'scale-curve'
    runs-on: ubuntu-latest
    timeout-minutes: 120
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: indexflow
          POSTGRES_PASSWORD: indexflow
          POSTGRES_DB: indexflow
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U indexflow -d indexflow"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
        env:
          discovery.type: single-node
          xpack.security.enabled: "false"
          ES_JAVA_OPTS: "-Xms2g -Xmx2g"
          ingest.geoip.downloader.enabled: "false"
        ports:
          - 9200:9200
    env:
      DATABASE_URL: postgresql://indexflow:indexflow@localhost:5432/indexflow?schema=public
      ES_URL: http://localhost:9200
      # 152k vectors plus chunk bodies; the default heap is not enough to reassemble them.
      NODE_OPTIONS: "--max-old-space-size=6144"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Cache BEIR archives
        uses: actions/cache@v4
        with:
          path: apps/web/.evalrun/beir
          key: beir-scale-curve-v1
      - name: Download shard vectors
        uses: actions/download-artifact@v4
        with:
          pattern: curve-shard-*
          merge-multiple: true
          path: apps/web/.evalrun/shards/
      - name: Write env file
        run: |
          {
            echo "DATABASE_URL=${DATABASE_URL}"
            echo "ES_URL=${ES_URL}"
          } > apps/web/.env
      - name: Apply migrations
        run: pnpm --filter @indexflow/web prisma migrate deploy
      - name: Wait for Elasticsearch
        run: |
          for i in $(seq 1 60); do
            if curl -fsS http://localhost:9200 >/dev/null 2>&1; then echo "ES up"; exit 0; fi
            sleep 5
          done
          echo "Elasticsearch did not become ready"; exit 1
      - name: Scale curve
        run: pnpm --filter @indexflow/web eval:scale-curve

  # Phase 9c: end-to-end ingestion through the real BullMQ worker. Needs the full stack — Redis
  # for the queue and MinIO for the original bytes — because the point is that the published
  # "index throughput" number measures bulk loading, which no upload ever uses.

  ingest-bench:
    name: ingestion throughput
    if: inputs.benchmark == 'ingestion'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: indexflow
          POSTGRES_PASSWORD: indexflow
          POSTGRES_DB: indexflow
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U indexflow -d indexflow"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
        env:
          discovery.type: single-node
          xpack.security.enabled: "false"
          ES_JAVA_OPTS: "-Xms1g -Xmx1g"
          ingest.geoip.downloader.enabled: "false"
        ports:
          - 9200:9200
      redis:
        image: redis:7
        ports:
          - 6380:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      DATABASE_URL: postgresql://indexflow:indexflow@localhost:5432/indexflow?schema=public
      ES_URL: http://localhost:9200
      REDIS_URL: redis://localhost:6380
      MINIO_ENDPOINT: http://localhost:9100
      MINIO_ACCESS_KEY: indexflow
      MINIO_SECRET_KEY: indexflow123
      MINIO_BUCKET: indexflow
      INGEST_DOCS: "40"
      INGEST_CONCURRENCY: "1,2,4,8"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Start MinIO
        run: |
          docker run -d --name minio -p 9100:9000 \
            -e MINIO_ROOT_USER=indexflow -e MINIO_ROOT_PASSWORD=indexflow123 \
            minio/minio:latest server /data
          for i in $(seq 1 30); do
            if curl -sf "http://localhost:9100/minio/health/live" >/dev/null; then
              echo "MinIO is up."; exit 0
            fi
            sleep 2
          done
          echo "MinIO did not become ready in time." >&2
          docker logs minio >&2 || true
          exit 1
      - name: Write env file
        run: |
          {
            echo "DATABASE_URL=${DATABASE_URL}"
            echo "ES_URL=${ES_URL}"
            echo "REDIS_URL=${REDIS_URL}"
            echo "MINIO_ENDPOINT=${MINIO_ENDPOINT}"
            echo "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}"
            echo "MINIO_SECRET_KEY=${MINIO_SECRET_KEY}"
            echo "MINIO_BUCKET=${MINIO_BUCKET}"
          } > apps/web/.env
      - name: Apply migrations
        run: pnpm --filter @indexflow/web prisma migrate deploy
      - name: Wait for Elasticsearch
        run: |
          for i in $(seq 1 60); do
            if curl -fsS http://localhost:9200 >/dev/null 2>&1; then echo "ES up"; exit 0; fi
            sleep 5
          done
          echo "Elasticsearch did not become ready"; exit 1
      - name: Ingestion benchmark
        run: pnpm --filter @indexflow/web bench:ingest
````

### `.github/workflows/codeql.yml`

_43 lines_

````yaml
name: CodeQL

# Static analysis for the security surfaces this project cares about — injection, unsafe
# deserialisation, missing authorization patterns. Runs on PRs, on main, and weekly so newly
# published rules are applied to code that has not changed.
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1" # Mondays, 06:00 UTC

jobs:
  analyze:
    name: analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript]

    steps:
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          # security-extended adds the lower-severity security rules; worth the extra runtime
          # on a project whose headline claim is permission-aware retrieval.
          queries: security-extended

      - name: Analyze
        uses: github/codeql-action/analyze@v3
        with:
          category: /language:${{ matrix.language }}
````

### `.github/workflows/dependency-review.yml`

_29 lines_

````yaml
name: Dependency review

# Fails a pull request that introduces a dependency with a known vulnerability, or one whose
# licence is incompatible. Cheap, and it catches the class of problem that no amount of reading
# our own code will.
on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ACTION REQUIRED to make this enforcing: enable Dependency graph at
      # Settings → Code security and analysis. Until then the action errors with "Dependency
      # review is not supported on this repository", which is a repo setting, not a code problem
      # — so it is non-blocking rather than a check that is permanently red for a reason nobody
      # can fix in a pull request. Remove continue-on-error once the setting is on.
      - uses: actions/dependency-review-action@v4
        continue-on-error: true
        with:
          fail-on-severity: high
          comment-summary-in-pr: on-failure
````

---

## 3. Everything else

Every remaining first-party source file, with its line count, exported symbols, and one line on
what it does. No bodies. Files reproduced in §2 are not repeated here.

Line counts are `wc -l`. Exported symbols are the module's `export` declarations; `default` means
a default export; `—` means the file exports nothing (a script executed for its side effects, a
test file, or an ambient type declaration).

### 3.1 `lib/` — domain modules not in §2

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/lib/prisma.ts` | 13 | `prisma` | Prisma client singleton, cached on `globalThis` so dev hot-reload does not open a new pool per reload. |
| `apps/web/lib/ingest.ts` | 93 | `ingestDocument` | The ingest pipeline body: download from MinIO → extract → chunk → embed → one Postgres transaction writing chunks, bumping `contentVersion`, and enqueuing the outbox event. Pre-generates chunk UUIDs so the same id keys both stores. Never writes Elasticsearch. |
| `apps/web/lib/extract.ts` | 29 | `extractText` | Text extraction for `.md`/`.txt` (UTF-8 decode) and `.pdf` (via `unpdf`), then strips C0 control characters that Postgres `TEXT` rejects. |
| `apps/web/lib/sharing.ts` | 117 | `GrantView`, `SharingError`, `SharingView`, `addGrant`, `assertOwner`, `getSharing`, `removeGrant`, `setPublic` | Owner-only sharing mutations behind the `/documents` panel. Every change calls `syncDocumentAcl`, which bumps `aclVersion` and re-projects. Authorization is `assertOwner`; the rest assume it passed. |
| `apps/web/lib/groups.ts` | 59 | `assertCanAdministerGroup`, `visibleGroupsWhere` | Group-administration authorization. Owner-only membership changes; ownerless groups fail closed; 404 rather than 403 when the caller cannot see the group. |
| `apps/web/lib/storage.ts` | 64 | `deleteObject`, `getObject`, `putObject`, `storageKeyFor` | MinIO/S3 object storage for original uploaded bytes, with lazy bucket creation. |
| `apps/web/lib/queue.ts` | 27 | `INGESTION_QUEUE`, `IngestionJobData`, `REDIS_URL`, `connection`, `getIngestionQueue` | BullMQ queue handle and Redis connection options. Lazy singleton so importing during `next build` never connects. |
| `apps/web/lib/demo.ts` | 63 | `DEMO_MODE`, `DEMO_USER_EMAIL`, `DEMO_USER_NAME`, `GUEST_ENABLED`, `SEED_TOKEN_HEADER`, `demoReadOnlyResponse`, `getOrCreateDemoUser`, `isValidSeedToken` | Public-demo switches: guest identity, read-only mode, and the seed-token check (`timingSafeEqual`, minimum 16 chars). All off unless the env var is set. |
| `apps/web/lib/usage.ts` | 57 | `UsageSnapshot`, `recordAnswerUsage`, `recordEvalRun`, `recordSearch`, `recordUpload`, `usageSnapshot` | In-memory usage counters behind `/api/ops/usage`. Per-process, reset on restart, explicitly not billing-grade. |

### 3.2 `app/` — pages

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/app/page.tsx` | 437 | `SearchPage` | The search page: three strategy modes, result list with `<mark>` highlighting, and the streamed answer panel with clickable citation chips. |
| `apps/web/app/layout.tsx` | 68 | `default`, `metadata` | Root layout, nav shell, and global metadata. |
| `apps/web/app/documents/page.tsx` | 412 | `DocumentsPage` | Permission-scoped document list with the inline sharing panel (public toggle, user grant, group grant, revoke). |
| `apps/web/app/eval/page.tsx` | 346 | `EvalPage` | Runs the retrieval benchmark against live services and renders the report in-browser. |
| `apps/web/app/groups/page.tsx` | 229 | `GroupsPage` | Group list and membership administration. |
| `apps/web/app/upload/page.tsx` | 134 | `UploadPage` | File upload form; returns immediately and links to `/jobs`. |
| `apps/web/app/jobs/page.tsx` | 131 | `JobsPage` | Ingestion job status with failure reasons and retry controls. |
| `apps/web/app/signin/page.tsx` | 64 | `default`, `metadata` | Google OAuth sign-in, plus "Continue as guest" when `GUEST_ENABLED`. |

### 3.3 `app/api/` — routes not in §2

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/app/api/documents/route.ts` | 66 | `GET`, `dynamic`, `runtime` | Permission-scoped document list, filtered by `documentVisibilityWhere`. |
| `apps/web/app/api/documents/upload/route.ts` | 122 | `POST`, `runtime` | Accepts the file, writes bytes to MinIO, creates `Document` + `IngestionJob`, enqueues the BullMQ job. Honours `DEMO_MODE` and the seed token. |
| `apps/web/app/api/documents/[id]/route.ts` | 66 | `DELETE`, `runtime` | Owner-gated delete; writes a deletion outbox event so the projection is removed. |
| `apps/web/app/api/documents/[id]/file/route.ts` | 51 | `GET`, `runtime` | Streams the original bytes. Gated by `assertCanRead` — this is the direct-object-access surface. |
| `apps/web/app/api/documents/[id]/history/route.ts` | 91 | `GET`, `dynamic`, `runtime` | Re-index/version history for a document. |
| `apps/web/app/api/groups/route.ts` | 86 | `GET`, `POST`, `dynamic`, `runtime` | List groups visible to the caller; create a group with the caller as owner. |
| `apps/web/app/api/groups/[id]/members/route.ts` | 110 | `POST`, `DELETE`, `runtime` | Add/remove members. Both call `assertCanAdministerGroup`. |
| `apps/web/app/api/jobs/route.ts` | 60 | `GET`, `dynamic`, `runtime` | Auth-gated job list, scoped to the caller's documents. |
| `apps/web/app/api/jobs/[id]/route.ts` | 116 | `GET`, `POST`, `dynamic`, `runtime` | Job detail and retry. |
| `apps/web/app/api/eval/route.ts` | 65 | `GET`, `dynamic`, `maxDuration`, `runtime` | Runs the retrieval eval on demand. Rate-limited 3/10min and capped at one concurrent run. |
| `apps/web/app/api/eval/rag/route.ts` | 80 | `GET`, `dynamic`, `maxDuration`, `runtime` | Runs the generation eval on demand. Rate-limited 1/hr, one concurrent run, 503s under `DEMO_MODE`. |
| `apps/web/app/api/health/route.ts` | 32 | `GET`, `dynamic`, `runtime` | Liveness plus a Postgres reachability probe. Used by the deploy smoke test. |
| `apps/web/app/api/ops/usage/route.ts` | 14 | `GET`, `dynamic`, `runtime` | Returns `usageSnapshot()` to signed-in operators. |
| `apps/web/app/api/auth/[...nextauth]/route.ts` | 4 | `runtime` | Auth.js catch-all handler re-export. |

### 3.4 `eval/` — harnesses not in §2

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/eval/dataset.ts` | 91 | `EvalDataset`, `EvalDoc`, `EvalQuery`, `Split`, `fingerprint`, `sha12` | The dataset contract shared by the in-domain and BEIR paths — docs, queries, graded judgments, split — plus SHA fingerprints over docs and judgments. |
| `apps/web/eval/beir.ts` | 225 | `BEIR_SUBSETS`, `BeirSpec`, `LoadOptions`, `fetchSubset`, `loadBeir` | Downloads and parses BEIR subsets (SciFact, NFCorpus, TREC-COVID) into the `EvalDataset` shape, with graded-relevance support. |
| `apps/web/eval/scale-run.ts` | 499 | — | BEIR scale evaluation: retrieves deep, truncates to `CANDIDATE_LIMIT`, reports nDCG/recall, runs the depth sweep and the oracle-rerank headroom calculation. |
| `apps/web/eval/scale-dataset.ts` | 201 | `SCALE_TIERS`, `ScaleChunk`, `ScaleDataset`, `ScaleDoc`, `TOP_TIER`, `buildScaleDataset`, `chunkCountsByTier`, `enumerateChunks` | Builds the nested 500 → 100,000-document corpora for the quality-vs-size curve. |
| `apps/web/eval/scale-curve.ts` | 336 | — | Runs the quality-vs-corpus-size curve across tiers using pre-computed embedding shards. |
| `apps/web/eval/embed-shard.ts` | 88 | — | Embeds one shard of the scale corpus; used by the 12-job CI matrix. Stamps a dataset hash the consumer verifies. |
| `apps/web/eval/depth-matrix.ts` | 191 | — | Sweeps per-leg retrieval depth (keyword × semantic) and reports the effect on held-out quality. |
| `apps/web/eval/rag-harness.ts` | 446 | `RagGateRow`, `RagItem`, `RagReport`, `runRagEvaluation` | Generation evaluation: retrieves, generates, and judges faithfulness (per claim), relevance, citations, and refusal correctness. |
| `apps/web/eval/rag-run.ts` | 92 | — | CLI entry point for the generation eval; prints the report and applies the gate. |
| `apps/web/eval/adversarial-run.ts` | 315 | — | Adversarial security benchmark: authorization probes, prompt-injection attempts, and a benign false-refusal control. |
| `apps/web/eval/sharing-check.ts` | 121 | — | Sharing lifecycle: grant → visible → revoke → invisible, asserted on both stores. |
| `apps/web/eval/dao-check.ts` | 186 | — | Direct-object-access checks across by-id fetch, delete, upload, and job listings. |
| `apps/web/eval/consistency-check.ts` | 180 | — | Cross-store consistency: lost revokes, false "ready", drift repair, idempotency, stale-write rejection. |
| `apps/web/eval/trec-export.ts` | 155 | — | Exports runs and qrels in TREC format for the `trec_eval` cross-check. |
| `apps/web/eval/crosscheck.py` | 137 | — (Python) | Compares this repo's metrics against NIST `trec_eval` via `pytrec_eval` and reports the maximum absolute deviation. |
| `apps/web/eval/export-labels.ts` | 220 | — | Emits the blind human audit sheet and a separate answer key for the generation judges. |
| `apps/web/eval/calibrate-judges.ts` | 194 | — | Scores human labels against judge verdicts: agreement, Cohen's κ, and disagreement direction per surface. |
| `apps/web/eval/label-audit.ts` | 278 | — | The same export/score treatment for the retrieval relevance labels (`labels:export` / `labels:score`). |

Non-source data files in `eval/`: `corpus.json`, `queries.json`, `answers.json` (the in-domain
fixture set), plus `RESULTS.md` and `improvements&adjustments.md`.

### 3.5 `bench/`

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/bench/latency-bench.ts` | 381 | — | Latency at 1k/10k/50k synthetic chunks: p50/p95 per strategy, HNSW build time, ANN recall@10. Shuffles strategy order per trial and runs 3 repeats. |
| `apps/web/bench/ingest-bench.ts` | 247 | — | End-to-end ingestion throughput through the real worker, with a per-stage breakdown and a concurrency sweep. |

### 3.6 `scripts/`

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/scripts/seed.ts` | 116 | — | Loads the 8-document demo corpus through the real HTTP upload route using the seed token. |
| `apps/web/scripts/backfill-es.ts` | 60 | — | Re-projects every document into Elasticsearch; used after a mapping change. |
| `apps/web/scripts/backfill-embeddings.ts` | 45 | — | Recomputes embeddings for chunks missing them. |
| `apps/web/scripts/reconcile.ts` | 36 | — | One-shot manual invocation of the drift reconciler. |
| `apps/web/scripts/outbox-drain.ts` | 29 | — | One-shot manual outbox drain. |
| `apps/web/scripts/retention-cleanup.ts` | 54 | — | Deletes old terminal jobs and completed outbox rows. Supports `DRY_RUN=1`. |
| `apps/web/scripts/smoke.ts` | 42 | — | Post-deploy smoke test: health, unauthenticated search, public listing, and that `/api/jobs` stays auth-gated. |

### 3.7 `test/` and `e2e/`

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/test/unit/metrics.test.ts` | 444 | — | 41 tests over the metric implementations, including ceilings and bootstrap behaviour. |
| `apps/web/test/unit/hybrid.test.ts` | 102 | — | 12 tests over `blendHybrid` and chunking, including the endpoint-honesty property (`w=1` ≡ keyword-only) and the lowest-hit normalisation wart. |
| `apps/web/test/unit/ratelimit.test.ts` | 82 | — | 10 tests over the fixed-window counter and concurrency guard. |
| `apps/web/test/unit/acl.test.ts` | 54 | — | 7 tests over principal-token construction and the visibility fragment. |
| `apps/web/test/unit/rerank.test.ts` | 18 | — | 3 tests over `rerankScoreFromLogits` (single-logit and two-class paths). |
| `apps/web/test/integration/security-regression.test.ts` | 376 | — | 23 tests against real Postgres + Elasticsearch + MinIO covering the consistency and authorization regressions. |
| `apps/web/test/setup-env.ts` | 32 | — | Vitest environment bootstrap. |
| `apps/web/e2e/principal-workflow.spec.ts` | 98 | — | 7 Playwright tests covering an unauthenticated visitor and a guest principal. |
| `apps/web/e2e/fixtures.ts` | 26 | `E2E_TAG`, `PRIVATE_BODY`, `PRIVATE_TERM`, `PRIVATE_TITLE`, `PUBLIC_BODY`, `PUBLIC_TERM`, `PUBLIC_TITLE` | Shared fixture constants for the E2E corpus. |
| `apps/web/e2e/global-setup.ts` | 54 | `default` | Seeds the E2E corpus before the run. |
| `apps/web/e2e/global-teardown.ts` | 23 | `default` | Removes the E2E corpus afterwards. |

### 3.8 Configuration and entry points

| File | Lines | Exports | Purpose |
|---|---:|---|---|
| `apps/web/auth.ts` | 41 | — | Auth.js instance: Prisma adapter, Google provider, guest credentials provider, JWT session callbacks. |
| `apps/web/auth.config.ts` | 32 | `authConfig` | Adapter-free config consumed by edge middleware, with the `authorized` callback. |
| `apps/web/middleware.ts` | 13 | `default`, `config` | Edge middleware protecting pages; skips API routes, Next internals, and static files. |
| `apps/web/instrumentation.ts` | 5 | `register` | Next.js instrumentation hook; defers to the Node-only file. |
| `apps/web/instrumentation.node.ts` | 15 | — | OpenTelemetry Node SDK setup with auto-instrumentation. |
| `apps/web/vitest.config.ts` | 34 | `default` | Vitest config, path aliases, and the unit/integration split. |
| `apps/web/playwright.config.ts` | 61 | `default` | Playwright config, web server, and global setup/teardown wiring. |
| `apps/web/types/next-auth.d.ts` | 10 | — | Module augmentation adding `id` to the session user. |
| `apps/web/next-env.d.ts` | 6 | — | Next.js generated ambient types. |
| `apps/web/next.config.mjs` | — | — | Next.js config (not `.ts`; excluded from the LOC table above). |
| `apps/web/postcss.config.mjs` | — | — | PostCSS/Tailwind v4 config. |
| `infra/docker-compose.yml` | 73 | — | Postgres+pgvector, Redis, Elasticsearch, MinIO with health checks. |
| `infra/Dockerfile` | — | — | Multi-stage build with `runner` (web) and `worker` targets. |

Also present and not reproduced: 10 Prisma migration directories under `apps/web/prisma/migrations/`
(327 lines of SQL total), the 8-document seed corpus under `apps/web/seed/corpus/`, and 19 Markdown
documents (5,443 lines) under `docs/`, `apps/web/eval/`, and the repository root.

---
## 4. Consistency check — code vs docs

Scope: the claims in `docs/indexflow-field-guide.md`, `apps/web/eval/RESULTS.md`, and
`docs/eval/FINDINGS.md`, checked against the source reproduced in §2. Discrepancies are listed
plainly and **not resolved**. Where a claim checks out, that is stated too, so the reviewer can
see what was actually verified rather than only what failed.

**Method note.** No evaluation was re-executed for this bundle. "Traceable to a captured run"
means the figure appears in `RESULTS.md` inside a captured output block carrying a command, a
timestamp, and (for CI runs) a run id. It does **not** mean the run was reproduced here.

### 4.1 Blend weight: production constant vs swept value

| | |
|---|---|
| Production constant | `DEFAULT_HYBRID_WEIGHT = 0.45` — `apps/web/lib/hybrid.ts:18` |
| Value the docs say the sweep selected | `0.45`, re-selected 2026-08-05 — `eval/RESULTS.md:171` |
| **Agreement** | **They match.** |

Consumers of the constant: `lib/retrieve.ts:155`, `app/api/search/route.ts:65`,
`bench/latency-bench.ts:213`, `eval/rag-harness.ts:213`, `eval/scale-run.ts`. Production search and
production RAG therefore share one weight, as the docs claim.

Findings on the *mechanism*, not the value:

1. **Nothing enforces the match.** The harness computes the sweep-selected weight at runtime and
   reports it (`eval/harness.ts:402-408`, printed by `eval/run.ts:140-152`); production reads the
   hardcoded constant. `eval/scale-run.ts:315` goes as far as printing
   `selected <x> (production constant is <y>)` — but that is console output. No CI gate compares
   the two, so a future divergence would print and pass.
2. **This exact drift has happened before, twice, per the source comment** at `lib/hybrid.ts:9-17`:
   the optimum moved 0.5 → 0.4 when ES BM25 replaced the earlier scorer, then the IF-3 held-out
   split selected 0.55 while the constant stayed 0.4 — so production served a blend that no
   published number described. The comment records this; the code still has no guard against a
   third occurrence.
3. **The selection criterion is not the reported metric.** The sweep maximises the *mean of
   per-kind MRR* (`balanced()`, `eval/harness.ts:392-398`) with exact and paraphrase weighted
   equally, while the headline is pooled MRR. Documented at `answer-indexflow.md` §1 and visible in
   the code; noted here because the two numbers are not the same quantity.
4. **0.45 is a plateau centre, not an optimum.** `eval/harness.ts:407-408` computes the plateau as
   every weight within `1e-9` of the maximum, and the docs report 0.20–0.70 all scoring 0.98 on the
   tuning split. The code and the claim agree.

### 4.2 `CANDIDATE_LIMIT` and `RAG_K` as actually set

| Constant | Value | Declared at | Docs claim | Match |
|---|---|---|---|---|
| `CANDIDATE_LIMIT` | `30` | `lib/retrieve.ts:25` | 30 | yes |
| `RAG_K` | `6` | `lib/rag.ts:15` | 6 | yes |

Both legs default to `CANDIDATE_LIMIT` (`lib/retrieve.ts:62`, `:87`), so retrieval is symmetric at
30/30 — which is what the docs say production runs, and what the harness mirrors
(`eval/harness.ts:23,238-239` imports the constant rather than restating it).

**Two duplicated constants that are not imported from the module that owns them:**

1. `eval/rag-harness.ts:42` declares its own `const RAG_K = 6` instead of importing `RAG_K` from
   `lib/rag`. The generation eval and the production answer path therefore agree by coincidence of
   two literals, not by construction. Changing `lib/rag.ts` would silently leave the eval measuring
   the old value.
2. `bench/latency-bench.ts:40` declares `const CANDIDATE_LIMIT = 30` with the comment
   `// per-leg candidates, mirrors lib/retrieve CANDIDATE_LIMIT`. Same pattern: the comment states
   the intent that the code does not enforce.

`eval/harness.ts`, `eval/scale-run.ts`, `eval/scale-curve.ts` and `eval/depth-matrix.ts` all import
the real constant, so the inconsistency is confined to those two files.

### 4.3 Do the SQL ACL predicate and the ES `terms` filter express the same rule?

**Substantively yes; three differences are worth recording.**

The SQL predicate (`lib/retrieve.ts:33-45`, `visibleToViewer`) is:

`d.is_public OR d.owner_id = $viewer OR EXISTS(grant with user_id = $viewer) OR EXISTS(grant joined
to group_members for $viewer)`

The Elasticsearch side (`lib/es.ts`, `keywordSearch`) applies `{ terms: { acl: aclPrincipals } }`
inside `bool.filter`, where the document's `acl` array is built by `aclTokens()`
(`lib/acl.ts:117-126`) as `{public if isPublic} ∪ {user:ownerId} ∪ {user:grant.userId} ∪
{group:grant.groupId}`, and the viewer's principals are built by `viewerFrom()`
(`lib/acl.ts:35-46`) as `{public} ∪ {user:viewerId} ∪ {group:each membership}`.

Term by term, set intersection is equivalent to the SQL disjunction: `public` ↔ `is_public`,
`user:<owner>` ↔ `owner_id`, `user:<grantee>` ↔ the first `EXISTS`, `group:<g>` ↔ the join. **The
rules agree.**

Differences:

1. **The ES helper's ACL argument defaults to "no filter"; the retriever's `viewer` is required.**
   `keywordSearch(q, fileType, size, index = CHUNK_INDEX, aclPrincipals: string[] | null = null)` —
   the fifth parameter defaults to `null`, and `if (aclPrincipals)` then skips the filter entirely.
   `fetchKeyword` always passes `viewer.principals` (`lib/retrieve.ts:66`), so the production path
   is filtered. But the documented "type-level guarantee — a future call site cannot forget it"
   holds for `retrieveContexts`/`fetchKeyword`, **not** for `keywordSearch` itself, whose default is
   permissive. A caller that omits the argument gets an unfiltered index scan and no type error.
   Callers relying on the permissive default today: `eval/scale-curve.ts:210` (four-argument call).
   That is an eval corpus with no ACLs, so it is not a live disclosure — but it demonstrates the
   default is reachable.
   *An empty array fails closed correctly:* `[]` is truthy in JS, so `terms: { acl: [] }` matches
   nothing. Only `null` fails open. Both behaviours are described in the comment at `lib/es.ts`.

2. **They are not consistent at the same instant.** The SQL predicate reads live ownership and
   grant tables, so it is correct the moment a transaction commits. The ES filter reads the `acl`
   array denormalised onto each chunk at *projection* time. The two agree only when the projection
   is current. The outbox, the version guard and the reconciler exist to bound that window, and
   `syncDocumentAcl` projects inline for the request that caused the change — but "enforced
   independently on both legs" means two mechanisms that converge, not two mechanisms that are
   simultaneously authoritative. A revoke is visible to the semantic leg strictly before the
   keyword leg.

3. **A both-principals grant widens access identically on both sides**, so the two remain
   equivalent even for a row the schema forbids. `aclTokens` adds both `user:` and `group:` tokens
   when a grant carries both (`lib/acl.ts:121-123`), and the SQL `EXISTS` clauses both match. The
   schema comment says this is prevented by the CHECK constraint
   `document_grants_exactly_one_principal` (migration `20260726020000`), so the case should not
   arise; noted only because the code comment flags it as a silent widening.

### 4.4 Is the advisory lock transaction-scoped, and does it wrap the full read-compare-write?

**Yes to both, as claimed.**

- `projectDocument` (`lib/outbox.ts:85-96`) opens `prisma.$transaction(tx => projectWithinLock(...))`
  with `timeout: 120_000, maxWait: 60_000`.
- The first statement inside `projectWithinLock` (`lib/outbox.ts:112`) is
  `SELECT pg_advisory_xact_lock(hashtextextended($documentId::text, 0))`. The `_xact_` variant is
  **transaction-scoped** — released on commit or rollback, with no cleanup path, exactly as the
  comment states.
- The lock is taken **before** the read (`tx.document.findUnique`, line 115), and the compare
  (`getProjectionState`, line 139), the version guard (143-146), the ES delete/write (171-172) and
  the `INDEXED` status transition (177-182) all follow inside the same transaction. **The full
  read-compare-write is inside the critical section.**

Four observations that do not contradict the claim but bound it:

1. **`ensureChunkIndex(index)` runs outside the transaction** (`lib/outbox.ts:89`), before it. It is
   idempotent index creation, not part of the invariant being protected.
2. **The Elasticsearch writes are not transactional.** `deleteDocumentChunks` and `indexChunks` are
   external I/O executed inside a Postgres transaction. If that transaction rolls back after
   `indexChunks` succeeded, Elasticsearch keeps the write while Postgres discards the status
   update. The version guard plus `reconcile()` restore convergence; the lock does not make the two
   writes atomic. The comment acknowledges the transaction holds a connection during ES I/O.
3. **`hashtextextended` maps a UUID onto a 64-bit integer.** A collision between two distinct
   document ids would serialise their projections unnecessarily. That is a throughput effect, not a
   correctness one.
4. **`drainOutbox` marks rows `DONE` before doing the work.** The claim statement
   (`lib/outbox.ts:200-211`) is a single `UPDATE … SET status = 'DONE' … RETURNING` under
   `FOR UPDATE SKIP LOCKED`; projection happens afterwards, and failure resets the row to `PENDING`
   (223-230). A process that dies between the claim and the projection leaves a row marked `DONE`
   for which no projection ran. `reconcile()` is the only backstop for that window, and it sweeps
   at most `limit = 500` documents ordered by `uploadedAt desc` — so a drifted document outside the
   500 most recent would not be re-queued.

### 4.5 Claims verified as accurate

Counted directly from the source in this bundle:

| Claim in docs | Verified value | Source |
|---|---|---|
| 73 unit tests | 73 (metrics 41, hybrid 12, ratelimit 10, acl 7, rerank 3) | `test/unit/*.test.ts` |
| 23 integration tests | 23 | `test/integration/security-regression.test.ts` |
| 7 Playwright tests | 7 | `e2e/principal-workflow.spec.ts` |
| 10 Prisma migrations | 10 | `prisma/migrations/` |
| 20 lib modules | 20 | `lib/*.ts` |
| 18 API endpoints | 18 | `find app/api -name route.ts` |
| 5 custom OTel spans | 5 (`fetchKeyword`, `fetchSemantic`, `retrieveContexts`, `rerank`, `generateAnswer`) | `lib/retrieve.ts`, `lib/llm.ts` |
| `acl:leak` 9/9 | 9 `check()` calls — 8 retrieval-leg, 1 generation-layer | `eval/acl-leak.ts:168-205` |
| `acl:sharing` 8/8 | 8 | `eval/sharing-check.ts` |
| `acl:dao` 13/13 | 13 | `eval/dao-check.ts` |
| `consistency:check` 8/8 | 8 | `eval/consistency-check.ts` |
| Adversarial "30 retrieval attempts" | 12 `authzQueries` + 18 generated = 30 | `eval/adversarial-run.ts:118-140` |
| Adversarial "10 injection attempts" | 10 `maliciousPrompts` | `eval/adversarial-run.ts` |
| Rate limits 30/min, 10/min, 20/hr, 3/10min, 1/hr | exact match | `lib/ratelimit.ts:161-169` |
| One-at-a-time concurrency cap | `tryAcquire(slot, max = 1)` | `lib/ratelimit.ts:135` |
| `EMBED_BATCH` 64, `WORKER_CONCURRENCY` 2 | exact match | `lib/embed.ts:277`, `worker/index.ts` |
| Outbox drain 5 s, reconcile 300 s | exact match | `worker/index.ts` |
| Codebase LOC table (eval 5,259 · lib 2,244 · app 3,197 · test 1,108 · bench 628 · scripts 382 · e2e 201 · worker 97) | all exact; total 13,116 vs "~13,100" | §1 of this bundle |
| Semantic runner-up 0.565 → 0.659 with depth | captured table | `docs/eval/WORKLOG.md:581-585` |

### 4.6 Discrepancies and untraceable numbers

Listed without resolution.

**D1 — The adversarial figures in `RESULTS.md` are the figures `FINDINGS.md` says do not exist.**
`RESULTS.md` §5 carries a captured run dated `2026-07-26T00:58:40Z`, `EXIT: 0`, printing
`Prompt injection leaks: 0 of 10 attempts`, and the `RESULTS.md` summary table lists it as **PASS**
with no strikethrough. `FINDINGS.md` item 7 states: *"The adversarial and false-refusal figures are
unrun… The previously published `0/10` injection figure came from a **hardcoded string**, not a
measurement — that is fixed, but no run has yet produced a real value."* The current code confirms
the fix and dates it: `eval/adversarial-run.ts:267-269` reads
*"Counted, not asserted. This line previously printed a hardcoded '0 of 10'"* and now prints
`${injectionFails} of ${maliciousPrompts.length}`. Since the captured run predates that fix, the
`0/10` in `RESULTS.md` §5 is the withdrawn hardcoded value, still presented as a passing gate. It is
quoted onward by `README.md`, `docs/indexflow-field-guide.md` §14, and
`docs/indexflow-project-overview.md`. The claim ledger in the field guide §16 and
`answer-indexflow.md` §5 simultaneously list `"0/10 prompt-injection leaks"` as **withdrawn**.

**D2 — The captured false-refusal denominator describes code that no longer exists.** The same
captured block prints `False refusals on legitimate queries: 0 of 2`. The current `BENIGN` array
holds **32** queries (`eval/adversarial-run.ts:186`), with a comment stating the previous two
"measures nothing". No run of the 32-query version is captured anywhere.

**D3 — `docs/indexflow-project-overview.md` reports two security counts that disagree with
`RESULTS.md`.** It states *"Permission leaks (retrieval legs) 8/8"* and *"Sharing lifecycle 6/6"*;
`RESULTS.md` and the code give **9** leak assertions (8 retrieval + 1 generation) and **8** sharing
assertions. The `8/8` is reconcilable as the retrieval-only subset; the **`6/6` matches nothing in
the code**, which has 8.

**D4 — "11 CI jobs" is correct as a count but the enumerated list is not a list of jobs.**
`.github/workflows/ci.yml` defines exactly 11 jobs: `build`, `unit`, `metrics`, `container`, `eval`,
`scale`, `bench`, `scale-curve-fetch`, `scale-curve-embed`, `scale-curve`, `ingest-bench`. The docs
enumerate 12 names — *"build/typecheck · unit · metric cross-check · retrieval eval gate · depth
matrix · ACL leak · sharing lifecycle · direct-object-access · cross-store consistency ·
integration · E2E · container builds"* — but `acl:dao`, `acl:leak`, `acl:sharing`,
`consistency:check`, `test:integration`, `test:e2e` and `eval:depth` are **steps inside the single
`eval` job** (`ci.yml:240-277`), not jobs. Additionally, **6 of the 11 jobs never run on a pull
request**: `scale`, `bench`, `scale-curve-fetch`, `scale-curve-embed`, `scale-curve` and
`ingest-bench` are each gated on a `workflow_dispatch` input. Only 5 jobs gate a PR. Two further
jobs exist outside `ci.yml` (`codeql.yml:analyze`, `dependency-review.yml:review`), giving 13
across all workflows.

**D5 — Generation metrics are not traceable to a current run.** Faithfulness 98%, refusal 92%,
relevance 100%, citations 100%, and the calibration figures (90% agreement, κ 0.29, κ 1.00 on
faithfulness) all come from the 2026-07-26 capture. `FINDINGS.md` item 6 states they were not
reproduced after `embed()` batching changed underneath them. The docs quote them with that caveat
attached; there is no captured run reflecting the current code.

**D6 — Two figures asserted in source comments have no captured artifact.**
 - *"Measured at roughly one in four runs before this lock existed"* — `lib/outbox.ts:104`. No run
   in `RESULTS.md` or `WORKLOG.md` records this measurement.
 - *"asks for roughly 4.5 GB"* for the pre-batching `embed()` OOM — `lib/embed.ts:271-276`. Stated
   as fact in the source, the field guide and `answer-indexflow.md`; no captured artifact.

**D7 — BEIR published baselines are quoted, not derived.** 0.665 / 0.325 / ≈0.645 come from the
literature. Explicitly acknowledged in `FINDINGS.md` item 1 and the claim ledger; recorded here for
completeness since three headline comparisons depend on them.

**D8 — "Average input tokens: 0" is a captured harness defect.** Flagged in `RESULTS.md` §5 itself
and in the field guide §20. The current code records `prompt_eval_count`; the benchmark has not been
re-run.

**D9 — A stale comment inside the source contradicts the architecture.** `lib/hybrid.ts:41`
describes the inputs as *"Keyword (ts_rank) and semantic (cosine)"*. `ts_rank` is Postgres
full-text search, which the keyword leg no longer uses — it is Elasticsearch BM25
(`lib/es.ts`). The docstring on the central fusion function names the wrong retrieval engine.

**Not re-verified in this bundle:** every figure in `RESULTS.md` §1, §1b, §6 and §6b — retrieval
quality, BEIR results, the scale curve, latency, and ingestion throughput. Each appears inside a
captured output block with a command and, where applicable, a CI run id, and each is reproducible in
principle by the commands listed in §3.4. None was re-executed here, so this bundle attests to
their *provenance*, not their *correctness*.

---

## 5. Gaps

### 5.1 TODO / FIXME / HACK comments

**None.** A recursive search across `apps/`, `infra/` and `.github/` for `TODO`, `FIXME`, `HACK`,
`XXX`, `@ts-ignore` and `@ts-expect-error` in `.ts`, `.tsx`, `.yml` and `.prisma` files returns no
matches.

### 5.2 Files with no test coverage

Determined by which modules any test file imports (`test/unit/`, `test/integration/`, `e2e/`).

**`lib/` modules exercised by tests (12 of 20):** `acl`, `chunk`, `es`, `groups`, `hybrid`,
`ingest`, `outbox`, `prisma`, `ratelimit`, `rerank`, `retrieve`, `storage`.

**`lib/` modules with no test importing them (8 of 20):**

| Module | Lines | Why it matters |
|---|---:|---|
| `lib/llm.ts` | 295 | The grounding prompt, the refusal sentence, `looksLikeRefusal()`, and all judge parsing. The largest untested module; `looksLikeRefusal` is pure string logic and directly gates the refusal-correctness metric. |
| `lib/sharing.ts` | 117 | Owner-only mutations. `assertOwner` is an authorization boundary; covered end-to-end by `eval/sharing-check.ts`, but by no unit or integration test. |
| `lib/demo.ts` | 63 | Includes `isValidSeedToken`, a `timingSafeEqual` comparison gating upload-as-demo-user. |
| `lib/embed.ts` | 62 | Contains the `EMBED_BATCH` fix for the OOM described in the docs; no test pins the batching behaviour. |
| `lib/usage.ts` | 57 | Counters only. |
| `lib/extract.ts` | 29 | PDF/text extraction and the C0 control-character strip that prevents a Postgres encoding error. |
| `lib/queue.ts` | 27 | Connection wiring. |
| `lib/rag.ts` | 31 | Orchestration seam; `RAG_K` lives here. |

**Other untested areas:**

- **All 8 pages and all 18 API routes** have no unit or integration test. Playwright covers the
  unauthenticated and guest paths through `/`, `/signin` and `/documents` at the HTTP level only.
- **20 of the 21 `eval/` files** have no test. Only `eval/metrics.ts` is unit-tested (41 tests) —
  which is the right one to test, but it means the harnesses that *produce* the published numbers
  are themselves unverified except by the `trec_eval` cross-check on the metrics.
- **`bench/` (628 lines), `scripts/` (382 lines) and `worker/` (97 lines)** have no tests. The
  worker is the process that owns ingestion, outbox draining and reconciliation in production.

### 5.3 Unfinished, stubbed, or vestigial

1. **The cross-encoder reranker is unreachable from any HTTP surface.** `retrieveContexts` takes
   `useReranker: boolean = false` (`lib/retrieve.ts:143`), and **no call site anywhere passes
   `true`** — `app/api/answer/route.ts:62`, `lib/rag.ts:27` and `eval/acl-leak.ts:97` all call it
   with three arguments. The only code that invokes `rerank()` directly is `eval/harness.ts:438`.
   `lib/rerank.ts` (66 lines) and its model download therefore ship in the application bundle but
   can only be exercised by the eval harness. The docs say "off by default", which is accurate but
   understates it: there is no runtime switch, request parameter, or environment variable that
   turns it on.

2. **A dead Postgres full-text index is still created and maintained.** Migration
   `20260629234600_fts_gin_index` creates
   `GIN (to_tsvector('english', content))` on `document_chunks`. No code references `to_tsvector`,
   `ts_rank` or `plainto_tsquery` any more — keyword search moved to Elasticsearch. The index is
   still built and updated on every chunk insert. This sits inside the Postgres write path that
   `bench:ingest` measures and attributes 89.5% to the Elasticsearch refresh.

3. **`syncDocumentAcl(documentId, _refresh = false)`** — `lib/acl.ts:151`. The second parameter is
   unused (underscore-prefixed) and retained only for call-site compatibility; the comment says
   projection is now always refresh-synchronous.

4. **`lib/rerank.ts` uses `any` for the model and tokenizer** (`interface Reranker { tokenizer: any;
   model: any }`, lines 326-329) in a repository whose docs describe TypeScript as strict.

5. **Vestigial configuration.** `apps/web/.env.example` carries
   `OPENAI_API_KEY=""` annotated *"(unused — embeddings run locally via Transformers.js)"*.

6. **A schema comment references a stage that does not exist.** `prisma/schema.prisma:13-15` says
   the `Account` table stores OAuth tokens *"which Stage C reuses to call the Google Drive API on
   the user's behalf"*. There is no Google Drive integration in the codebase.

7. **Formatting drift in one block.** The reranker branch in `lib/retrieve.ts:156-190` carries
   trailing whitespace and a different brace/blank-line style from the rest of the file, suggesting
   it was added separately and not run through the formatter.

8. **`docs/ROADMAP.md` reports IF-4 as "Implemented; environment provisioning outstanding"** and
   the claim ledger states the project is not deployed to a public URL. Consistent between the two,
   recorded here as the one phase not closed.

---

## Bundle manifest

| | |
|---|---|
| Sections | 5 |
| Files reproduced verbatim (§2) | 24 |
| Files inventoried (§3) | 79 |
| Requested paths that do not exist | 1 — `prisma/schema.prisma` (real path: `apps/web/prisma/schema.prisma`) |
| Evaluations re-executed for this bundle | 0 |

_Bundle generated 2026-08-13 11:19:59 MST. Final size reported by the generating session._
