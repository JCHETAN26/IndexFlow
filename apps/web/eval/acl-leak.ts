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
