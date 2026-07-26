/**
 * Cross-store consistency — the IF-1 exit criterion, as a runnable check.
 *
 * Postgres is the source of truth; Elasticsearch is a projection of it. Every way that
 * projection can diverge is a correctness bug, and two of them are security bugs:
 *
 *   1. REVOKE LOST TO A RACE. ingestDocument reads the document's ACL, then spends seconds
 *      embedding, then writes that snapshot into ES. A revoke landing in that window updates
 *      zero ES chunks (the new ones do not exist yet) and is then overwritten by the stale
 *      snapshot — so a principal whose access was revoked can still reach the document through
 *      the keyword leg.
 *   2. FALSELY READY. The document is marked INDEXED inside the Postgres transaction, before
 *      the ES mirror is attempted. If the mirror fails, the document reads as fully indexed
 *      while being invisible to the keyword leg.
 *
 * Run: pnpm --filter @indexflow/web consistency:check
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { viewerFrom } from "../lib/acl";
import { syncDocumentAcl } from "../lib/acl";
import { ingestDocument } from "../lib/ingest";
import { ensureChunkIndex, deleteDocumentChunks, countDocumentChunks } from "../lib/es";
import { drainOutbox, reconcile } from "../lib/outbox";
import { fetchKeyword } from "../lib/retrieve";
import { putObject, storageKeyFor } from "../lib/storage";

const TAG = "[consistency-check]";

let failures = 0;
function check(pass: boolean, label: string) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}

// Distinctive enough that a keyword hit is unambiguous.
const SECRET = "zarquon";
const BODY = `Project ${SECRET} quarterly plan. The ${SECRET} initiative covers migration, rollout and staffing. ` +
  `Every paragraph mentions ${SECRET} so the keyword leg has plenty of signal to rank on. ` +
  `Additional filler so the chunker produces a real chunk rather than a degenerate one.`;

async function seedRealDocument(ownerId: string, granteeId: string) {
  const documentId = randomUUID();
  const storageKey = storageKeyFor(documentId, "consistency.txt");
  await putObject(storageKey, Buffer.from(BODY, "utf8"), "text/plain");

  await prisma.document.create({
    data: {
      id: documentId,
      title: `${TAG} ${SECRET} plan`,
      fileName: "consistency.txt",
      fileType: "txt",
      storageKey,
      status: "UPLOADED",
      isPublic: false,
      ownerId,
      grants: { create: [{ userId: granteeId }] },
    },
  });
  return documentId;
}

async function main() {
  await ensureChunkIndex();
  const stamp = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { email: `cons-owner-${stamp}@example.test`, name: `${TAG} owner` },
    select: { id: true },
  });
  const grantee = await prisma.user.create({
    data: { email: `cons-grantee-${stamp}@example.test`, name: `${TAG} grantee` },
    select: { id: true },
  });

  const docIds: string[] = [];

  try {
    // ── 1. Revoke racing an in-flight re-index ──
    console.log(`\n${TAG} revoke racing an in-flight index`);
    console.log("─".repeat(64));

    const docId = await seedRealDocument(owner.id, grantee.id);
    docIds.push(docId);

    // Index it once so the grantee legitimately has access.
    await ingestDocument(docId);
    const vGrantee = await viewerFrom(grantee.id);
    const before = await fetchKeyword(SECRET, null, vGrantee);
    check(
      before.some((c) => c.documentId === docId),
      "grantee CAN reach the document while granted [positive control]",
    );

    // Now: start a re-index and revoke the grant while it is in flight. The re-index reads the
    // ACL up front; the revoke lands during embedding; the re-index then writes its snapshot.
    const reindex = ingestDocument(docId);
    await new Promise((r) => setTimeout(r, 150)); // let ingest get past its ACL read
    const grant = await prisma.documentGrant.findFirst({
      where: { documentId: docId, userId: grantee.id },
      select: { id: true },
    });
    await prisma.documentGrant.delete({ where: { id: grant!.id } });
    await syncDocumentAcl(docId, true); // what the sharing route does on revoke
    await reindex;

    // Postgres is the source of truth and says the grant is gone. The keyword leg must agree.
    const after = await fetchKeyword(SECRET, null, await viewerFrom(grantee.id));
    check(
      !after.some((c) => c.documentId === docId),
      "revoked grantee CANNOT reach the document after a racing re-index",
    );

    // ── 2. A projection that never happened must not read as "ready", and must be recoverable ──
    // `project: false` reproduces a crash between the Postgres commit and the ES write.
    console.log(`\n${TAG} readiness when the projection has not happened`);
    console.log("─".repeat(64));

    const doc2 = await seedRealDocument(owner.id, grantee.id);
    docIds.push(doc2);
    await ingestDocument(doc2, { project: false });

    const unprojected = await prisma.document.findUnique({
      where: { id: doc2 },
      select: { status: true },
    });
    check(
      unprojected?.status !== "INDEXED" && (await countDocumentChunks(doc2)) === 0,
      "an unprojected document does NOT read as INDEXED (no false 'ready')",
    );
    check(
      (await prisma.outboxEvent.count({ where: { documentId: doc2, status: "PENDING" } })) > 0,
      "the owed projection is durably recorded in the outbox",
    );

    // The durable path must finish the job with no further help.
    await drainOutbox();
    const recovered = await prisma.document.findUnique({
      where: { id: doc2 },
      select: { status: true },
    });
    check(
      recovered?.status === "INDEXED" && (await countDocumentChunks(doc2)) > 0,
      "draining the outbox completes the projection and marks it INDEXED",
    );

    // ── 3. Drift introduced behind the app's back must be detected and repaired ──
    console.log(`\n${TAG} reconciliation of out-of-band drift`);
    console.log("─".repeat(64));

    await deleteDocumentChunks(doc2, undefined, true); // someone/something clobbers ES
    check((await countDocumentChunks(doc2)) === 0, "drift introduced [setup]");

    const { repaired } = await reconcile();
    check(repaired.includes(doc2), "reconcile DETECTS the drifted document");
    await drainOutbox();
    check((await countDocumentChunks(doc2)) > 0, "reconcile REPAIRS it (chunks are back in ES)");
  } finally {
    for (const id of docIds) {
      await deleteDocumentChunks(id, undefined, true).catch(() => {});
      await prisma.document.delete({ where: { id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, grantee.id] } } }).catch(() => {});
  }

  console.log("─".repeat(64));
  if (failures === 0) {
    console.log("Postgres and Elasticsearch stay consistent. ✓");
  } else {
    console.error(`${failures} cross-store consistency failure(s). ✗`);
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
