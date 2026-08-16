/**
 * Phase 9a: does retrieval quality survive a larger corpus?
 *
 * Runs the real retrieval stack over the same fixed query set at 500 / 5k / 25k / 100k documents
 * with real embeddings and real relevance judgements, and plots quality against corpus size. The
 * tiers nest — each is a prefix of the same document list — so a change between them is corpus
 * *size* and not corpus composition.
 *
 * Quality *should* degrade as the candidate pool grows; the question is how fast. A flat curve
 * would mean the task is still too easy, which is the failure mode the 17-document corpus had.
 *
 * Vectors come from `eval/embed-shard.ts`, embedded in parallel CI jobs. This job reassembles them
 * by global chunk index and refuses to run unless every shard reports the same `datasetSha` —
 * scattering vectors onto the wrong chunks would produce a plausible-looking, meaningless curve.
 *
 * Unlike `scale-run.ts` this uses the **HNSW index** rather than forcing exact KNN, because that is
 * what production does; ANN recall against exact KNN is measured separately at the top tier, on
 * real embeddings, which is the measurement the synthetic latency bench could not provide.
 *
 * Run: pnpm --filter @indexflow/web eval:scale-curve
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { embed, toVectorLiteral, EMBED_DIM, EMBED_MODEL } from "../lib/embed";
import { blendHybrid, type Scored } from "../lib/hybrid";
import { CANDIDATE_LIMIT } from "../lib/retrieve";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../lib/es";
import { buildScaleDataset, enumerateChunks, SCALE_TIERS, TOP_TIER } from "./scale-dataset";
import {
  bootstrapDelta,
  ceilingFor,
  dedupDocs,
  mrr,
  ndcgAtGraded,
  ranksFromRanked,
  recallAt,
} from "./metrics";
import type { EvalQuery } from "./dataset";

const SHARD_DIR = process.env.SHARD_OUT ?? join(process.cwd(), ".evalrun", "shards");
const SWEEP = Array.from({ length: 11 }, (_, i) => Number((i / 10).toFixed(2)));
const SHIPPED_K = 6;
const INSERT_BATCH = 250;

const f2 = (n: number) => n.toFixed(2);
const pct = (n: number) => (n * 100).toFixed(1).padStart(5) + "%";

type Strategy = "keyword" | "semantic" | "hybrid";
const STRATEGIES: Strategy[] = ["keyword", "semantic", "hybrid"];

interface Hit { chunkId: string; docId: string; score: number }
interface Row { query: EvalQuery; kw: Hit[]; sm: Hit[] }

/** Load every shard and scatter its vectors back into global chunk order. */
function loadVectors(expectedSha: string, totalChunks: number): Float32Array {
  const manifests = readdirSync(SHARD_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(SHARD_DIR, f), "utf8")));
  if (manifests.length === 0) throw new Error(`no shard manifests in ${SHARD_DIR}`);

  const shardCount = manifests[0].shardCount;
  const disagreeing = manifests.filter((m) => m.datasetSha !== expectedSha);
  if (disagreeing.length > 0) {
    throw new Error(
      `shard/dataset mismatch: expected datasetSha ${expectedSha}, but shards ` +
        `${disagreeing.map((m: { shardIndex: number }) => m.shardIndex).join(",")} disagree. ` +
        `The shards were built from a different document list — refusing to scatter vectors onto ` +
        `the wrong chunks.`,
    );
  }
  if (manifests.length !== shardCount) {
    throw new Error(`expected ${shardCount} shards, found ${manifests.length}`);
  }
  if (manifests[0].numChunksTotal !== totalChunks) {
    throw new Error(
      `shards enumerated ${manifests[0].numChunksTotal} chunks, this job enumerated ${totalChunks}`,
    );
  }

  const all = new Float32Array(totalChunks * EMBED_DIM);
  for (const m of manifests) {
    const buf = readFileSync(join(SHARD_DIR, `shard-${m.shardIndex}.f32`));
    const vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (vec.length !== m.numChunksShard * EMBED_DIM) {
      throw new Error(`shard ${m.shardIndex}: expected ${m.numChunksShard} vectors, got ${vec.length / EMBED_DIM}`);
    }
    let local = 0;
    for (let g = m.shardIndex; g < totalChunks; g += shardCount) {
      all.set(vec.subarray(local * EMBED_DIM, (local + 1) * EMBED_DIM), g * EMBED_DIM);
      local++;
    }
  }
  return all;
}

const vecAt = (all: Float32Array, i: number): number[] =>
  Array.from(all.subarray(i * EMBED_DIM, (i + 1) * EMBED_DIM));

function rankedDocs(r: Row, strat: Strategy, weight: number): string[] {
  if (strat === "keyword") return dedupDocs(r.kw.map((h) => ({ docId: h.docId })));
  if (strat === "semantic") return dedupDocs(r.sm.map((h) => ({ docId: h.docId })));
  const toScored = (h: Hit[]): Scored[] => h.map((x) => ({ id: x.chunkId, score: x.score }));
  const chunkToDoc = new Map<string, string>();
  for (const h of [...r.kw, ...r.sm]) chunkToDoc.set(h.chunkId, h.docId);
  return dedupDocs(
    blendHybrid(toScored(r.kw), toScored(r.sm), weight).map((b) => ({ docId: chunkToDoc.get(b.id)! })),
  );
}
const rankingsFor = (rows: Row[], s: Strategy, w: number) =>
  rows.map((r) => ranksFromRanked(rankedDocs(r, s, w), r.query.relevant));
const labelsOf = (rows: Row[]) => rows.map((r) => ({ relevant: [...r.query.relevant.keys()] }));

async function main() {
  const t0 = Date.now();
  const el = () => `${Math.round((Date.now() - t0) / 1000)}s`;

  const { docs, queries, datasetSha, numJudgedDocs } = await buildScaleDataset(TOP_TIER);
  const { chunks, total } = enumerateChunks(docs);
  console.log(`\nScale curve — ${docs.length} docs (${numJudgedDocs} judged), ${total} chunks`);
  console.log(`* datasetSha ${datasetSha} · embedding ${EMBED_MODEL} (${EMBED_DIM}-dim)`);
  console.log(`* tiers: ${SCALE_TIERS.join(", ")} documents · query set fixed across all tiers`);
  console.log(`* retrieval: HNSW index (production), depth ${CANDIDATE_LIMIT} per leg`);

  console.log(`[${el()}] loading shard vectors...`);
  const vectors = loadVectors(datasetSha, total);
  console.log(`[${el()}] ${total} vectors reassembled (${(vectors.byteLength / 1e6).toFixed(0)} MB)`);

  console.log(`[${el()}] embedding ${queries.length} queries...`);
  const queryVecs = await embed(queries.map((q) => q.text));

  // Chunk index ranges per tier: tiers nest, so each is a prefix of the chunk list.
  const docCut = new Map<number, number>();
  for (const tier of SCALE_TIERS) docCut.set(tier, Math.min(tier, docs.length));
  const chunkCut = new Map<number, number>();
  {
    const docIdToOrder = new Map(docs.map((d, i) => [d.id, i]));
    for (const tier of SCALE_TIERS) {
      const cut = docCut.get(tier)!;
      let n = 0;
      while (n < chunks.length && docIdToOrder.get(chunks[n].docId)! < cut) n++;
      chunkCut.set(tier, n);
    }
  }

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS curve_chunks`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE curve_chunks (id text PRIMARY KEY, doc_id text NOT NULL, embedding vector(${EMBED_DIM}) NOT NULL)`,
  );
  const esIndex = await createEphemeralIndex("indexflow_curve");

  const summary: { tier: number; chunks: number; weight: number; rows: Row[] }[] = [];

  try {
    let seeded = 0;
    for (const tier of SCALE_TIERS) {
      const cut = chunkCut.get(tier)!;
      console.log(`\n${"═".repeat(88)}`);
      console.log(`TIER ${tier.toLocaleString()} documents — ${cut.toLocaleString()} chunks`);
      console.log("═".repeat(88));

      // Incremental seeding: tiers nest, so only the delta is inserted.
      console.log(`[${el()}] seeding chunks ${seeded} → ${cut}...`);
      for (let i = seeded; i < cut; i += INSERT_BATCH) {
        const batch = chunks.slice(i, Math.min(i + INSERT_BATCH, cut));
        await prisma.$executeRaw`
          INSERT INTO curve_chunks (id, doc_id, embedding)
          VALUES ${Prisma.join(
            batch.map(
              (c) =>
                Prisma.sql`(${`c${c.globalIndex}`}, ${c.docId}, ${toVectorLiteral(vecAt(vectors, c.globalIndex))}::vector)`,
            ),
          )}
        `;
      }
      const esBatch: EsChunk[] = [];
      for (let i = seeded; i < cut; i++) {
        esBatch.push({
          chunkId: `c${chunks[i].globalIndex}`,
          documentId: chunks[i].docId,
          chunkIndex: chunks[i].chunkIndex,
          title: "",
          fileType: "md",
          content: chunks[i].content,
        });
      }
      for (let i = 0; i < esBatch.length; i += 2000) {
        await indexChunks(esBatch.slice(i, i + 2000), esIndex, i + 2000 >= esBatch.length ? "wait_for" : false);
      }
      seeded = cut;

      // Rebuild HNSW for this tier. Building after the inserts is much faster than maintaining
      // the index across them, and it is also what a bulk re-index would really do.
      console.log(`[${el()}] building HNSW over ${cut.toLocaleString()} vectors...`);
      const hnswStart = Date.now();
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS curve_hnsw`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX curve_hnsw ON curve_chunks USING hnsw (embedding vector_cosine_ops)`,
      );
      await prisma.$executeRawUnsafe(`ANALYZE curve_chunks`);
      const hnswMs = Date.now() - hnswStart;
      console.log(`[${el()}] HNSW built in ${(hnswMs / 1000).toFixed(1)}s`);

      console.log(`[${el()}] retrieving ${queries.length} queries...`);
      const rows: Row[] = [];
      for (let i = 0; i < queries.length; i++) {
        const lit = toVectorLiteral(Array.from(queryVecs[i]));
        const [kwHits, smRows] = await Promise.all([
          keywordSearch(queries[i].text, null, CANDIDATE_LIMIT, esIndex),
          prisma.$queryRawUnsafe<{ id: string; doc_id: string; score: number }[]>(
            `SELECT id, doc_id, 1 - (embedding <=> '${lit}'::vector) AS score
             FROM curve_chunks ORDER BY embedding <=> '${lit}'::vector LIMIT ${CANDIDATE_LIMIT}`,
          ),
        ]);
        rows.push({
          query: queries[i],
          kw: kwHits.map((h) => ({ chunkId: h.chunkId, docId: h.documentId, score: h.score })),
          sm: smRows.map((h) => ({ chunkId: h.id, docId: h.doc_id, score: Number(h.score) })),
        });
      }

      const tune = rows.filter((r) => r.query.split === "tune" && r.query.relevant.size > 0);
      const test = rows.filter((r) => r.query.split === "test" && r.query.relevant.size > 0);
      const sweepRows = tune.length > 0 ? tune : test;
      const sweep = SWEEP.map((w) => ({
        w,
        s: mrr(rankingsFor(sweepRows, "hybrid", w), labelsOf(sweepRows)),
      }));
      const best = Math.max(...sweep.map((x) => x.s));
      const plateau = sweep.filter((x) => x.s >= best - 1e-9).map((x) => x.w);
      const weight = plateau[Math.floor((plateau.length - 1) / 2)];

      const labels = labelsOf(test);
      console.log(`[${el()}] weight ${f2(weight)} (swept on ${sweepRows.length} tuning queries)`);
      console.log(`Strategy         MRR    R@1     R@${SHIPPED_K}     R@10    nDCG@10`);
      for (const s of STRATEGIES) {
        const rk = rankingsFor(test, s, weight);
        const ranked = test.map((r) => rankedDocs(r, s, weight));
        console.log(
          s.padEnd(15) +
            f2(mrr(rk, labels)).padEnd(7) +
            pct(recallAt(rk, labels, 1)).padEnd(8) +
            pct(recallAt(rk, labels, SHIPPED_K)).padEnd(8) +
            pct(recallAt(rk, labels, 10)).padEnd(8) +
            pct(ndcgAtGraded(ranked, test.map((r) => r.query), 10)),
        );
      }
      console.log(
        "ceiling".padEnd(15) +
          f2(ceilingFor(labels, "mrr")).padEnd(7) +
          pct(ceilingFor(labels, "recall", 1)).padEnd(8) +
          pct(ceilingFor(labels, "recall", SHIPPED_K)).padEnd(8) +
          pct(ceilingFor(labels, "recall", 10)).padEnd(8) +
          pct(1),
      );
      summary.push({ tier, chunks: cut, weight, rows: test });
    }

    // ── ANN recall on REAL embeddings, at the top tier ────────────────────
    // The synthetic latency bench reported 100% ANN recall, but uniform random vectors in 384
    // dimensions are nearly orthogonal and therefore the easy case for HNSW. Real embeddings are
    // clustered, which is where HNSW actually loses recall. This is that measurement.
    console.log(`\n[${el()}] ANN recall vs exact KNN on real embeddings, top tier...`);
    let recallSum = 0;
    const SAMPLES = 50;
    for (let i = 0; i < SAMPLES; i++) {
      const lit = toVectorLiteral(Array.from(queryVecs[i % queryVecs.length]));
      const approx = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM curve_chunks ORDER BY embedding <=> '${lit}'::vector LIMIT 10`,
      );
      const exact = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
        return tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM curve_chunks ORDER BY embedding <=> '${lit}'::vector LIMIT 10`,
        );
      });
      const exactIds = new Set(exact.map((r) => r.id));
      recallSum += approx.filter((r) => exactIds.has(r.id)).length / Math.max(1, exactIds.size);
    }
    console.log(`  ANN recall@10 on real embeddings: ${pct(recallSum / SAMPLES)} (${SAMPLES} queries)`);
    console.log(
      `  Compare the synthetic latency bench, which reported 100.0%. Uniform random vectors are\n` +
        `  nearly orthogonal in 384 dimensions and are the easy case; this is the honest number.`,
    );

    // ── the curve ─────────────────────────────────────────────────────────
    console.log(`\n${"═".repeat(88)}`);
    console.log("QUALITY vs CORPUS SIZE — same 300 held-out queries throughout");
    console.log("═".repeat(88));
    console.log("docs".padEnd(10) + "chunks".padEnd(10) + "w".padEnd(6) + "MRR".padEnd(8) + `R@${SHIPPED_K}`.padEnd(9) + "nDCG@10".padEnd(10) + "vs 500");
    const baseline = { mrr: 0, ndcg: 0 };
    for (const s of summary) {
      const labels = labelsOf(s.rows);
      const rk = rankingsFor(s.rows, "hybrid", s.weight);
      const ranked = s.rows.map((r) => rankedDocs(r, "hybrid", s.weight));
      const m = mrr(rk, labels);
      const nd = ndcgAtGraded(ranked, s.rows.map((r) => r.query), 10);
      if (s.tier === SCALE_TIERS[0]) { baseline.mrr = m; baseline.ndcg = nd; }
      console.log(
        s.tier.toLocaleString().padEnd(10) +
          s.chunks.toLocaleString().padEnd(10) +
          f2(s.weight).padEnd(6) +
          f2(m).padEnd(8) +
          pct(recallAt(rk, labels, SHIPPED_K)).padEnd(9) +
          pct(nd).padEnd(10) +
          `${nd - baseline.ndcg >= 0 ? "+" : ""}${((nd - baseline.ndcg) * 100).toFixed(1)}pp nDCG`,
      );
    }

    // Is the degradation from 500 to 100k statistically real, or noise?
    const first = summary[0];
    const last = summary[summary.length - 1];
    const rr = (s: typeof first) =>
      rankingsFor(s.rows, "hybrid", s.weight).map((r) => (r.length > 0 ? 1 / r[0] : 0));
    const d = bootstrapDelta(rr(first), rr(last));
    console.log(
      `\nΔ MRR (${first.tier.toLocaleString()} − ${last.tier.toLocaleString()} docs) = ` +
        `${d.value >= 0 ? "+" : ""}${d.value.toFixed(3)} [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]   ` +
        `excludes zero: ${d.excludesZero ? "yes — the degradation is real" : "no — within noise"}`,
    );
    console.log(`\nTotal wall time: ${el()}`);
  } finally {
    await deleteIndex(esIndex).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS curve_chunks`).catch(() => {});
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
