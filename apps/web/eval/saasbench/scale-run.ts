/**
 * SaaSBench scale curve (remediation Phases 6 and 7).
 *
 * Runs the same frozen query set against a growing corpus and reports what happens to retrieval
 * quality. The question is the one the brief asks: **how much quality is lost when the in-domain
 * search space grows by two orders of magnitude?**
 *
 * ## Why this is affordable
 *
 * SaaSBench corpora are nested — the document list at 5,000 is an exact prefix of the list at
 * 100,000, because the labelled core is fixed and filler is drawn from one deterministic stream.
 * Two consequences:
 *
 *   - **Embedding happens once.** Every rung reuses vectors computed for the largest corpus.
 *   - **Indexing is incremental.** Each rung adds the next tranche to the same Elasticsearch index
 *     and the same Postgres transaction, rather than rebuilding from scratch. BM25 corpus
 *     statistics and the KNN neighbourhood both update as documents arrive, which is what makes the
 *     smaller rungs genuine measurements rather than filtered views of a big one.
 *
 * Post-hoc filtering — indexing everything once and discarding out-of-rung hits — would be far
 * cheaper and would be wrong: IDF depends on corpus composition, so a document's BM25 score at
 * 5,000 documents is not its score at 100,000 with the extras hidden.
 *
 *   pnpm --filter @indexflow/web saasbench:scale
 *   SAASBENCH_LADDER=3400,5000,8000 pnpm --filter @indexflow/web saasbench:scale
 */
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { chunkText } from "../../lib/chunk";
import { embed, toVectorLiteral } from "../../lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT } from "../../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../../lib/es";
import { ndcgAtGraded, ranksFromRanked, mrr, recallAt, bootstrapDelta } from "../metrics";
import { buildSnapshot } from "./generate";
import type { SaasQuery } from "./queries";

const LADDER = (process.env.SAASBENCH_LADDER ?? "3400,5000,10000,25000,50000,100000")
  .split(",")
  .map((s) => Number(s.trim()))
  .sort((a, b) => a - b);
const SEED = Number(process.env.SAASBENCH_SEED ?? 42);
/**
 * Cap on test queries, for proving the rung-to-rung mechanism cheaply. Retrieval costs roughly
 * half a second per query per rung at these corpus sizes — 902 queries is ~7 minutes of every rung
 * — so a smoke run caps this. A published curve must NOT: the full frozen set is the measurement.
 */
const MAX_QUERIES = Number(process.env.SAASBENCH_MAX_QUERIES ?? 0);
const DEPTH = 50;
const INSERT_BATCH = 500;
const EMBED_SLICE = 2000;

class Rollback extends Error {}

const f3 = (n: number) => n.toFixed(3);
const pctS = (n: number) => `${(n * 100).toFixed(1)}%`;

interface Hit { chunkId: string; docId: string; score: number }

interface RungScores {
  docs: number;
  chunks: number;
  keyword: Metrics;
  semantic: Metrics;
  hybrid: Metrics;
}
interface Metrics {
  ndcg10: number;
  mrr10: number;
  r10: number;
  success1: number;
  perQuery: number[];
}

function scoreOne(rankings: string[][], queries: SaasQuery[]): Metrics {
  const keep = queries
    .map((q, i) => ({ q, ranked: rankings[i] }))
    .filter((r) => Object.keys(r.q.qrels).length > 0);
  const graded = keep.map((r) => ({ relevant: new Map(Object.entries(r.q.qrels)) }));
  const ranked = keep.map((r) => r.ranked);
  const binary = keep.map((r) => ({ relevant: Object.keys(r.q.qrels) }));
  const ranks = keep.map((r) => ranksFromRanked(r.ranked, new Map(Object.entries(r.q.qrels))));
  return {
    ndcg10: ndcgAtGraded(ranked, graded, 10),
    mrr10: mrr(ranks, binary),
    r10: recallAt(ranks, binary, 10),
    success1:
      keep.length === 0
        ? 0
        : keep.filter((r) => r.ranked.length > 0 && (r.q.qrels[r.ranked[0]] ?? 0) > 0).length / keep.length,
    perQuery: keep.map((r, i) => ndcgAtGraded([ranked[i]], [graded[i]], 10)),
  };
}

function toDocRanking(hits: Hit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.docId)) continue;
    seen.add(h.docId);
    out.push(h.docId);
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const el = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
  const largest = LADDER[LADDER.length - 1];

  console.log(`\n[saasbench-scale] ladder ${LADDER.join(" -> ")} · seed ${SEED}`);
  const snap = await buildSnapshot(largest, SEED);
  const allTest = snap.queries.filter((q) => q.split === "test");
  const test = MAX_QUERIES > 0 ? allTest.slice(0, MAX_QUERIES) : allTest;
  if (MAX_QUERIES > 0) {
    console.log(`  ⚠ SMOKE RUN: ${test.length} of ${allTest.length} test queries. Not a publishable curve.`);
  }
  console.log(`  ${snap.documents.length} documents · ${test.length} test queries`);
  console.log(`  corpus ${snap.manifest.corpusHash.slice(0, 12)} · queries ${snap.manifest.queriesHash.slice(0, 12)}\n`);

  // Chunk the whole corpus once, remembering where each rung ends. Chunks stay in document order,
  // so a rung is a prefix of the chunk list exactly as it is a prefix of the document list.
  const chunks: { docId: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  const chunkEndForRung = new Map<number, number>();
  let cursor = 0;
  for (const [i, d] of snap.documents.entries()) {
    for (const c of chunkText(`${d.title}\n\n${d.body}`)) {
      chunks.push({ docId: d.id, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
    cursor = i + 1;
    const rung = LADDER.find((r) => r === cursor);
    if (rung !== undefined) chunkEndForRung.set(rung, chunks.length);
  }
  for (const r of LADDER) if (!chunkEndForRung.has(r)) chunkEndForRung.set(r, chunks.length);
  console.log(`${el()} ${chunks.length} chunks total (${(chunks.length / snap.documents.length).toFixed(2)} per document)`);

  console.log(`${el()} embedding chunks (once, reused by every rung)...`);
  const chunkVecs: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_SLICE) {
    chunkVecs.push(...(await embed(chunks.slice(i, i + EMBED_SLICE).map((c) => c.content))));
    console.log(`${el()}   ${Math.min(i + EMBED_SLICE, chunks.length)}/${chunks.length}  rss=${Math.round(process.memoryUsage().rss / 1e6)}MB`);
  }
  console.log(`${el()} embedding ${test.length} queries...`);
  const queryVecs = await embed(test.map((q) => q.text));

  const uuidByDoc = new Map(snap.documents.map((d) => [d.id, randomUUID() as string]));
  const docByUuid = new Map([...uuidByDoc].map(([id, uuid]) => [uuid, id]));
  const chunkToDoc = new Map(chunks.map((c) => [c.chunkId, c.docId]));

  const esIndex = await createEphemeralIndex("saasbench_scale");
  const rungs: RungScores[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

        let docsDone = 0;
        let chunksDone = 0;

        for (const rung of LADDER) {
          const docEnd = Math.min(rung, snap.documents.length);
          const chunkEnd = chunkEndForRung.get(rung)!;

          // ── add this rung's tranche to both stores ──────────────────────
          const newDocs = snap.documents.slice(docsDone, docEnd);
          const newChunks = chunks.slice(chunksDone, chunkEnd);
          console.log(`\n${el()} rung ${rung}: +${newDocs.length} documents, +${newChunks.length} chunks`);

          const esChunks: EsChunk[] = newChunks.map((c) => ({
            chunkId: c.chunkId,
            documentId: uuidByDoc.get(c.docId)!,
            chunkIndex: c.index,
            title: "",
            fileType: "md",
            content: c.content,
          }));
          for (let i = 0; i < esChunks.length; i += 2000) {
            await indexChunks(esChunks.slice(i, i + 2000), esIndex, i + 2000 >= esChunks.length ? "wait_for" : false);
          }

          for (let i = 0; i < newDocs.length; i += INSERT_BATCH) {
            const batch = newDocs.slice(i, i + INSERT_BATCH);
            await tx.$executeRaw`
              INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
              VALUES ${Prisma.join(
                batch.map(
                  (d) =>
                    Prisma.sql`(${uuidByDoc.get(d.id)}::uuid, ${d.title}, ${`${d.id}.${d.fileType}`}, ${d.fileType}, 'INDEXED', now(), now())`,
                ),
              )}
            `;
          }
          for (let i = 0; i < newChunks.length; i += INSERT_BATCH) {
            const batch = newChunks.slice(i, i + INSERT_BATCH);
            await tx.$executeRaw`
              INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
              VALUES ${Prisma.join(
                batch.map(
                  (c, j) =>
                    Prisma.sql`(${c.chunkId}::uuid, ${uuidByDoc.get(c.docId)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[chunksDone + i + j])}::vector, now())`,
                ),
              )}
            `;
          }
          docsDone = docEnd;
          chunksDone = chunkEnd;

          // ── measure ────────────────────────────────────────────────────
          console.log(`${el()} rung ${rung}: retrieving...`);
          const kwRank: string[][] = [];
          const smRank: string[][] = [];
          const hyRank: string[][] = [];
          for (let i = 0; i < test.length; i++) {
            const kwHits = (await keywordSearch(test[i].text, null, DEPTH, esIndex)).map((h) => ({
              chunkId: h.chunkId,
              docId: docByUuid.get(h.documentId)!,
              score: h.score,
            }));
            const vec = toVectorLiteral(queryVecs[i]);
            const smRows = await tx.$queryRaw<{ chunkId: string; docUuid: string; score: number }[]>`
              SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docUuid",
                     1 - (dc.embedding <=> ${vec}::vector) AS score
              FROM document_chunks dc
              WHERE dc.embedding IS NOT NULL
              ORDER BY dc.embedding <=> ${vec}::vector
              LIMIT ${DEPTH}
            `;
            const smHits = smRows.map((h) => ({
              chunkId: h.chunkId,
              docId: docByUuid.get(h.docUuid)!,
              score: Number(h.score),
            }));
            const blended = blendHybrid(
              kwHits.map((h) => ({ id: h.chunkId, score: h.score })),
              smHits.map((h) => ({ id: h.chunkId, score: h.score })),
              DEFAULT_HYBRID_WEIGHT,
            );
            kwRank.push(toDocRanking(kwHits));
            smRank.push(toDocRanking(smHits));
            hyRank.push(
              toDocRanking(blended.map((b) => ({ chunkId: b.id, docId: chunkToDoc.get(b.id)!, score: b.score }))),
            );
          }

          rungs.push({
            docs: docEnd,
            chunks: chunkEnd,
            keyword: scoreOne(kwRank, test),
            semantic: scoreOne(smRank, test),
            hybrid: scoreOne(hyRank, test),
          });
          const last = rungs[rungs.length - 1];
          console.log(
            `${el()} rung ${rung}: keyword ${f3(last.keyword.ndcg10)} · semantic ${f3(last.semantic.ndcg10)} · hybrid ${f3(last.hybrid.ndcg10)}`,
          );
        }
        throw new Rollback();
      },
      { timeout: 6 * 60 * 60_000, maxWait: 120_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }

  // ── report ──────────────────────────────────────────────────────────────
  console.log(`\n${el()} scale curve — nDCG@10 (same ${test.length} queries at every rung)\n`);
  console.log("  documents   chunks    keyword  semantic   hybrid    best");
  for (const r of rungs) {
    const best = (["keyword", "semantic", "hybrid"] as const).reduce((a, b) =>
      r[b].ndcg10 > r[a].ndcg10 ? b : a,
    );
    console.log(
      `  ${String(r.docs).padStart(9)} ${String(r.chunks).padStart(8)}    ` +
        `${f3(r.keyword.ndcg10)}     ${f3(r.semantic.ndcg10)}    ${f3(r.hybrid.ndcg10)}    ${best}`,
    );
  }

  const first = rungs[0], last = rungs[rungs.length - 1];
  console.log("\n  retention (metric at largest / metric at smallest):");
  for (const s of ["keyword", "semantic", "hybrid"] as const) {
    const delta = bootstrapDelta(first[s].perQuery, last[s].perQuery);
    console.log(
      `  ${s.padEnd(9)} nDCG@10 ${f3(first[s].ndcg10)} -> ${f3(last[s].ndcg10)}  ` +
        `retention ${pctS(last[s].ndcg10 / Math.max(first[s].ndcg10, 1e-9))}  ` +
        `Δ ${f3(delta.value)} [${f3(delta.lo)}, ${f3(delta.hi)}]${delta.excludesZero ? " excludes zero" : " includes zero"}`,
    );
  }
  console.log("\n  Success@1 / MRR@10 / R@10 at each rung:");
  for (const r of rungs) {
    console.log(
      `  ${String(r.docs).padStart(9)}  hybrid  S@1 ${pctS(r.hybrid.success1)}  MRR ${f3(r.hybrid.mrr10)}  R@10 ${pctS(r.hybrid.r10)}`,
    );
  }

  const outDir = join(process.cwd(), ".evalrun", "saasbench");
  await mkdir(outDir, { recursive: true });
  const artifact = {
    ladder: LADDER,
    seed: SEED,
    corpusHash: snap.manifest.corpusHash,
    queriesHash: snap.manifest.queriesHash,
    testQueries: test.length,
    rungs: rungs.map((r) => ({
      docs: r.docs,
      chunks: r.chunks,
      keyword: { ndcg10: r.keyword.ndcg10, mrr10: r.keyword.mrr10, r10: r.keyword.r10, success1: r.keyword.success1 },
      semantic: { ndcg10: r.semantic.ndcg10, mrr10: r.semantic.mrr10, r10: r.semantic.r10, success1: r.semantic.success1 },
      hybrid: { ndcg10: r.hybrid.ndcg10, mrr10: r.hybrid.mrr10, r10: r.hybrid.r10, success1: r.hybrid.success1 },
    })),
  };
  await writeFile(join(outDir, "scale-curve.json"), JSON.stringify(artifact, null, 2));
  console.log(`\n  raw results -> ${join(outDir, "scale-curve.json")}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
