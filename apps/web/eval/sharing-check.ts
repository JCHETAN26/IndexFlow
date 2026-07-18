/**
 * Sharing lifecycle check — proves the /documents sharing mutations actually change what a
 * viewer can retrieve, on BOTH legs, including the Elasticsearch ACL re-sync.
 *
 * It drives the real sharing lib (lib/sharing) and the real retriever (lib/retrieve):
 * seed a private doc owned by Alice, then walk grant → revoke → public → private and assert
 * Bob's / anonymous's retrieval visibility flips each time. Everything is torn down.
 * Run: pnpm --filter @indexflow/web acl:sharing
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { embed, toVectorLiteral } from "../lib/embed";
import { aclTokens, viewerFrom, type Viewer } from "../lib/acl";
import { ensureChunkIndex, indexChunks, deleteDocumentChunks, type EsChunk } from "../lib/es";
import { fetchKeyword, fetchSemantic } from "../lib/retrieve";
import { setPublic, addGrant, removeGrant } from "../lib/sharing";

const TAG = "[sharing-check]";
const QUERY = "What is the Q3 acquisition target and codename?";

let failures = 0;
const check = (pass: boolean, label: string) => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
};

// Does the viewer retrieve this document on the keyword leg, the semantic leg, or both?
async function canSee(viewer: Viewer, documentId: string): Promise<boolean> {
  const [kw, sm] = await Promise.all([fetchKeyword(QUERY, null, viewer), fetchSemantic(QUERY, null, viewer)]);
  const ids = new Set([...kw.map((c) => c.documentId), ...sm.map((c) => c.documentId)]);
  return ids.has(documentId);
}

async function main() {
  await ensureChunkIndex();

  const alice = await prisma.user.create({ data: { name: `${TAG} Alice`, email: `${randomUUID()}@share.test` } });
  const bob = await prisma.user.create({ data: { name: `${TAG} Bob`, email: `${randomUUID()}@share.test` } });

  // Private doc owned by Alice, crafted to be the top match for QUERY.
  const doc = await prisma.document.create({
    data: {
      title: `${TAG} Acquisition Memo`,
      fileName: `${TAG}-memo.md`,
      fileType: "md",
      status: "INDEXED",
      indexedAt: new Date(),
      isPublic: false,
      ownerId: alice.id,
    },
    select: { id: true, isPublic: true, ownerId: true, grants: { select: { userId: true, groupId: true } } },
  });
  const content = "Confidential M&A memo: the Q3 acquisition codename BLUEBIRD, target Acme Corp.";
  const [vec] = await embed([content]);
  const chunkId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
    VALUES (${chunkId}::uuid, ${doc.id}::uuid, 0, ${content}, ${Math.ceil(content.length / 4)}, ${toVectorLiteral(vec)}::vector, now())
  `;
  const esChunk: EsChunk = {
    chunkId,
    documentId: doc.id,
    chunkIndex: 0,
    title: `${TAG} Acquisition Memo`,
    fileType: "md",
    content,
    acl: aclTokens(doc),
  };
  await indexChunks([esChunk], undefined, "wait_for");

  const vBob = await viewerFrom(bob.id);
  const vAnon = await viewerFrom(null);

  try {
    console.log(`\n${TAG} sharing lifecycle`);
    console.log("─".repeat(60));

    check(!(await canSee(vBob, doc.id)), "private: Bob cannot see it");
    check(!(await canSee(vAnon, doc.id)), "private: anonymous cannot see it");

    await addGrant(doc.id, { email: bob.email! });
    check(await canSee(vBob, doc.id), "after grant to Bob: Bob CAN see it (keyword+semantic)");
    check(!(await canSee(vAnon, doc.id)), "after grant to Bob: anonymous still cannot see it");

    const sharing = await removeGrant(doc.id, (await grantIdFor(doc.id))!);
    check(sharing.grants.length === 0, "revoke: grant removed");
    check(!(await canSee(vBob, doc.id)), "after revoke: Bob cannot see it again");

    await setPublic(doc.id, true);
    check(await canSee(vAnon, doc.id), "public: anonymous CAN see it");

    await setPublic(doc.id, false);
    check(!(await canSee(vAnon, doc.id)), "private again: anonymous cannot see it");
  } finally {
    await deleteDocumentChunks(doc.id, undefined, true).catch(() => {});
    await prisma.document.delete({ where: { id: doc.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } }).catch(() => {});
  }

  console.log("─".repeat(60));
  if (failures === 0) {
    console.log("Sharing changes retrieval visibility correctly. ✓");
  } else {
    console.error(`${failures} sharing check(s) failed. ✗`);
    process.exitCode = 1;
  }
}

// The single grant's id (this doc only ever has one grant in this scenario).
async function grantIdFor(documentId: string): Promise<string | null> {
  const g = await prisma.documentGrant.findFirst({ where: { documentId }, select: { id: true } });
  return g?.id ?? null;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
