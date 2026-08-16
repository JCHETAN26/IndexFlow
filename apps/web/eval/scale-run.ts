/**
 * Retrieval evaluation at scale, against a public labelled corpus.
 *
 * Phase 8. Every number produced before this ran was measured on 17 documents, where "retrieval"
 * is a 17-way classification problem and R@5 sits at 100% of its attainable ceiling. This runs the
 * same retrieval stack — same chunker, same embeddings, same Elasticsearch BM25, same blend — over
 * thousands of documents with third-party relevance judgements, so the numbers can be compared to
 * published baselines by someone who does not trust this repository.
 *
 * Deliberately separate from `harness.ts`, which keeps scoring the 64-query in-domain set as the
 * CI regression suite. The two share `metrics.ts` and every `lib/` component that does the actual
 * retrieving; what differs is seeding strategy (batched, because 14k single-row inserts inside one
 * transaction will time out) and the absence of exact/paraphrase query kinds, which BEIR does not
 * label.
 *
 * Run: BEIR_SUBSET=scifact pnpm --filter @indexflow/web eval:scale
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral, EMBED_MODEL, EMBED_DIM } from "../lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "../lib/hybrid";
import { CANDIDATE_LIMIT } from "../lib/retrieve";
import {
  createEphemeralIndex,
  deleteIndex,
  indexChunks,
  keywordSearch,
  type EsChunk,
} from "../lib/es";
import { loadBeir } from "./beir";
import { describe as describeDataset, fingerprint, type EvalDataset, type EvalQuery } from "./dataset";
import {
  bootstrapCI,
  bootstrapDelta,
  ceilingFor,
  dedupDocs,
  mrr,
  ndcgAtGraded,
  precisionAt,
  ranksFromRanked,
  recallAt,
  type Interval,
} from "./metrics";

type Strategy = "keyword" | "semantic" | "hybrid";
const STRATEGIES: Strategy[] = ["keyword", "semantic", "hybrid"];

const SWEEP = Array.from({ length: 21 }, (_, i) => Number((i / 20).toFixed(2)));
const INSERT_BATCH = 500;

/**
 * Retrieve this deep, then truncate to `CANDIDATE_LIMIT` for the headline numbers.
 *
 * Truncating a ranked list to k is exactly what retrieving k returns, for both legs (ES returns
 * BM25's top-k by score; the semantic leg is `ORDER BY ... LIMIT k`), so one deep pass supports
 * both the shipped configuration and the diagnostics. Retrieving deep is what makes recall@100 and
 * the pool ceiling measurable at all — at depth 30 they are unanswerable by construction.
 */
const DIAG_DEPTH = Number(process.env.BEIR_DEPTH ?? 100);
/** The k that actually reaches the generator: `retrieveContexts(query, 6, ...)` in the RAG path. */
const SHIPPED_K = 6;
const f2 = (n: number) => n.toFixed(2);
const f3 = (n: number) => n.toFixed(3);
const pct = (n: number) => (n * 100).toFixed(1).padStart(5) + "%";

class Rollback extends Error {}

interface Hit {
  chunkId: string;
  docId: string;
  score: number;
}
interface Row {
  query: EvalQuery;
  kw: Hit[];
  sm: Hit[];
}

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

const rankingsFor = (rows: Row[], strat: Strategy, w: number): number[][] =>
  rows.map((r) => ranksFromRanked(rankedDocs(r, strat, w), r.query.relevant));

/** Truncate both legs to a depth — exactly equivalent to having retrieved at that depth. */
const atDepth = (r: Row, d: number): Row => ({ ...r, kw: r.kw.slice(0, d), sm: r.sm.slice(0, d) });

/**
 * Fraction of relevant documents present anywhere in the union of the two legs' candidates.
 *
 * Separates "ranked badly" from "never retrieved". If this is well below 1, no amount of
 * reranking can recover the missing documents and depth is the binding constraint — which is
 * exactly the question `CANDIDATE_LIMIT = 30` raises on a dataset with ~38 relevant docs per query.
 */
function poolCeiling(rows: Row[]): number {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const total = r.query.relevant.size;
    if (total === 0) continue;
    const pool = new Set([...r.kw, ...r.sm].map((h) => h.docId));
    let found = 0;
    for (const id of r.query.relevant.keys()) if (pool.has(id)) found++;
    sum += found / total;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

const labelsOf = (rows: Row[]) => rows.map((r) => ({ relevant: [...r.query.relevant.keys()] }));

/**
 * Best recall@k any reordering of the existing candidate pool could achieve.
 *
 * The pool ceiling says what is *reachable* at all; this says what is reachable **at the cut-off a
 * consumer actually reads**. The gap between measured recall@k and this number is the headroom a
 * perfect reranker would have — everything above it needs deeper retrieval or better candidates,
 * not better ordering.
 *
 * Needed because "a reranker can add at most 1.5 points" was derived at k=30 and does not transfer
 * to k=6, which is what the RAG path consumes.
 */
function oracleRerankAt(rows: Row[], k: number): number {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const total = r.query.relevant.size;
    if (total === 0) continue;
    const pool = new Set([...r.kw, ...r.sm].map((h) => h.docId));
    let inPool = 0;
    for (const id of r.query.relevant.keys()) if (pool.has(id)) inPool++;
    sum += Math.min(k, inPool) / total;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

async function main() {
  const subset = process.env.BEIR_SUBSET ?? "scifact";
  const maxDocs = process.env.BEIR_MAX_DOCS ? Number(process.env.BEIR_MAX_DOCS) : undefined;
  const maxTestQueries = process.env.BEIR_MAX_QUERIES ? Number(process.env.BEIR_MAX_QUERIES) : undefined;

  const t0 = Date.now();
  const ds: EvalDataset = await loadBeir(subset, { maxDocs, maxTestQueries });
  const stats = describeDataset(ds);
  const fp = fingerprint(ds);

  console.log(`\nScale eval — ${ds.name}`);
  console.log(`* Source: ${ds.source}`);
  console.log(`* Dataset ${ds.version} (docs ${fp.docs}, queries ${fp.queries})`);
  console.log(
    `* ${stats.numDocs} documents · ${stats.numTune} tuning / ${stats.numTest} held-out queries ` +
      `(${stats.numJudgedTest} judged)`,
  );
  console.log(
    `* ${stats.judgmentsTotal} judgments · ${f2(stats.relPerJudgedQuery)} relevant per judged query · ` +
      `relevance ${stats.graded ? "GRADED" : "binary"}`,
  );
  console.log(`* Embedding: ${EMBED_MODEL} (${EMBED_DIM}-dim)`);
  console.log(
    `* Retrieval depth: ${DIAG_DEPTH} per leg, truncated to ${CANDIDATE_LIMIT} (production CANDIDATE_LIMIT) ` +
      `for the headline table; the full depth is used only for recall@100 and the pool ceiling`,
  );

  // ── chunk + embed ───────────────────────────────────────────────────────
  const chunks: { docId: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  for (const d of ds.docs) {
    const body = d.title ? `${d.title}\n\n${d.content}` : d.content;
    for (const c of chunkText(body)) {
      chunks.push({ docId: d.id, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }
  console.log(`* ${chunks.length} chunks (${f2(chunks.length / ds.docs.length)} per document)`);

  // Embed in visible slices. `embed` batches internally; this exists so a 10-minute step reports
  // progress instead of looking like a hang, and so a kill can be located precisely.
  const embedProgress = async (texts: string[], label: string): Promise<number[][]> => {
    const SLICE = 1000;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += SLICE) {
      out.push(...(await embed(texts.slice(i, i + SLICE))));
      console.log(
        `[${Math.round((Date.now() - t0) / 1000)}s]   ${label}: ${Math.min(i + SLICE, texts.length)}/${texts.length}` +
          `  rss=${Math.round(process.memoryUsage().rss / 1e6)}MB`,
      );
    }
    return out;
  };

  console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] embedding ${chunks.length} chunks...`);
  const chunkVecs = await embedProgress(chunks.map((c) => c.content), "chunks");
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] embedding ${ds.queries.length} queries...`);
  const queryVecs = await embedProgress(ds.queries.map((q) => q.text), "queries");

  // Stable UUIDs per BEIR document id — the DB columns are uuid-typed.
  const uuidByDoc = new Map<string, string>(ds.docs.map((d) => [d.id, randomUUID() as string]));
  const docByUuid = new Map<string, string>([...uuidByDoc].map(([docId, uuid]) => [uuid, docId]));

  const esIndex = await createEphemeralIndex();
  const rows: Row[] = [];
  try {
    // ── keyword leg ───────────────────────────────────────────────────────
    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] indexing into Elasticsearch...`);
    const esChunks: EsChunk[] = chunks.map((c) => ({
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

    console.log(`[${Math.round((Date.now() - t0) / 1000)}s] keyword retrieval, ${ds.queries.length} queries...`);
    const kwByQuery: Hit[][] = [];
    for (const q of ds.queries) {
      const hits = await keywordSearch(q.text, null, DIAG_DEPTH, esIndex);
      kwByQuery.push(
        hits.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.documentId)!, score: h.score })),
      );
    }

    // ── semantic leg ──────────────────────────────────────────────────────
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
          await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

          console.log(`[${Math.round((Date.now() - t0) / 1000)}s] seeding ${ds.docs.length} documents...`);
          for (let i = 0; i < ds.docs.length; i += INSERT_BATCH) {
            const batch = ds.docs.slice(i, i + INSERT_BATCH);
            await tx.$executeRaw`
              INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
              VALUES ${Prisma.join(
                batch.map(
                  (d) =>
                    Prisma.sql`(${uuidByDoc.get(d.id)}::uuid, ${d.title || d.id}, ${`${d.id}.md`}, 'md', 'INDEXED', now(), now())`,
                ),
              )}
            `;
          }

          console.log(`[${Math.round((Date.now() - t0) / 1000)}s] seeding ${chunks.length} chunks...`);
          for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
            const batch = chunks.slice(i, i + INSERT_BATCH);
            await tx.$executeRaw`
              INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
              VALUES ${Prisma.join(
                batch.map(
                  (c, j) =>
                    Prisma.sql`(${c.chunkId}::uuid, ${uuidByDoc.get(c.docId)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i + j])}::vector, now())`,
                ),
              )}
            `;
          }

          console.log(`[${Math.round((Date.now() - t0) / 1000)}s] semantic retrieval (exact KNN)...`);
          for (let i = 0; i < ds.queries.length; i++) {
            const vec = toVectorLiteral(queryVecs[i]);
            const sm = await tx.$queryRaw<{ chunkId: string; docUuid: string; score: number }[]>`
              SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docUuid",
                     1 - (dc.embedding <=> ${vec}::vector) AS score
              FROM document_chunks dc
              WHERE dc.embedding IS NOT NULL
              ORDER BY dc.embedding <=> ${vec}::vector
              LIMIT ${DIAG_DEPTH}
            `;
            rows.push({
              query: ds.queries[i],
              kw: kwByQuery[i],
              sm: sm.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.docUuid)!, score: Number(h.score) })),
            });
          }
          throw new Rollback();
        },
        { timeout: 45 * 60_000, maxWait: 60_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }

  // ── weight sweep on the tuning split ────────────────────────────────────
  const deepTune = rows.filter((r) => r.query.split === "tune" && r.query.relevant.size > 0);
  const deepTest = rows.filter((r) => r.query.split === "test" && r.query.relevant.size > 0);
  // Everything scored below is at production depth; the deep lists are kept for diagnostics only.
  const tune = deepTune.map((r) => atDepth(r, CANDIDATE_LIMIT));
  const test = deepTest.map((r) => atDepth(r, CANDIDATE_LIMIT));
  const sweepRows = tune.length > 0 ? tune : test;

  // BEIR does not label query kinds, so the harness's balanced-by-kind criterion does not apply;
  // pooled MRR is the honest fallback and is stated rather than silently substituted.
  const sweep = SWEEP.map((w) => ({ w, mrr: mrr(rankingsFor(sweepRows, "hybrid", w), labelsOf(sweepRows)) }));
  const best = Math.max(...sweep.map((s) => s.mrr));
  const plateau = sweep.filter((s) => s.mrr >= best - 1e-9).map((s) => s.w);
  const weight = plateau[Math.floor((plateau.length - 1) / 2)];

  console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] weight sweep on ${sweepRows.length} tuning queries (pooled MRR — BEIR has no query kinds)`);
  console.log("  " + sweep.map((s) => `${f2(s.w)}:${f2(s.mrr)}${s.w === weight ? "*" : " "}`).join("  "));
  console.log(`  selected ${f2(weight)} (production constant is ${f2(DEFAULT_HYBRID_WEIGHT)})`);

  // ── held-out metrics ────────────────────────────────────────────────────
  const labels = labelsOf(test);
  console.log(`\n${"─".repeat(88)}`);
  console.log(`HELD-OUT — ${test.length} judged queries over ${stats.numDocs} documents`);
  console.log("─".repeat(88));
  console.log(`Strategy         MRR    R@1     R@${SHIPPED_K}*     R@10    P@3     nDCG@10`);
  console.log(`  * R@${SHIPPED_K} is the k that reaches the generator (retrieveContexts(query, ${SHIPPED_K}, ...))`);
  console.log("─".repeat(88));

  const rankedByStrategy = new Map<Strategy, string[][]>();
  for (const s of STRATEGIES) rankedByStrategy.set(s, test.map((r) => rankedDocs(r, s, weight)));

  for (const s of STRATEGIES) {
    const rk = rankingsFor(test, s, weight);
    const ranked = rankedByStrategy.get(s)!;
    console.log(
      s.padEnd(15) +
        f2(mrr(rk, labels)).padEnd(7) +
        pct(recallAt(rk, labels, 1)).padEnd(8) +
        pct(recallAt(rk, labels, SHIPPED_K)).padEnd(8) +
        pct(recallAt(rk, labels, 10)).padEnd(8) +
        pct(precisionAt(rk, labels, 3)).padEnd(8) +
        pct(ndcgAtGraded(ranked, test.map((r) => r.query), 10)),
    );
  }
  const ceil = {
    mrr: ceilingFor(labels, "mrr"),
    r1: ceilingFor(labels, "recall", 1),
    rk: ceilingFor(labels, "recall", SHIPPED_K),
    r10: ceilingFor(labels, "recall", 10),
    p3: ceilingFor(labels, "precision", 3),
  };
  console.log(
    "ceiling".padEnd(15) +
      f2(ceil.mrr).padEnd(7) +
      pct(ceil.r1).padEnd(8) +
      pct(ceil.rk).padEnd(8) +
      pct(ceil.r10).padEnd(8) +
      pct(ceil.p3).padEnd(8) +
      pct(1),
  );
  console.log("─".repeat(88));

  // ── depth diagnostics ───────────────────────────────────────────────────
  // Does depth 30 limit recall, or does ranking? The pool ceiling answers it directly: it is the
  // share of relevant documents present anywhere in the candidate union, so anything below it is
  // reachable by better ranking and anything above it is unreachable at any amount of reranking.
  console.log(`depth diagnostics — is CANDIDATE_LIMIT=${CANDIDATE_LIMIT} the binding constraint?`);
  const deepLabels = labelsOf(deepTest);
  for (const s of STRATEGIES) {
    const shallow = rankingsFor(test, s, weight);
    const deep = rankingsFor(deepTest, s, weight);
    console.log(
      `  ${s.padEnd(12)} R@10 ${pct(recallAt(shallow, labels, 10))}   ` +
        `R@30 ${pct(recallAt(shallow, labels, CANDIDATE_LIMIT))}   ` +
        `R@100 ${pct(recallAt(deep, deepLabels, 100))}   (last needs depth ${DIAG_DEPTH})`,
    );
  }
  console.log(
    `  candidate pool ceiling: ${pct(poolCeiling(test))} at depth ${CANDIDATE_LIMIT}, ` +
      `${pct(poolCeiling(deepTest))} at depth ${DIAG_DEPTH}`,
  );
  console.log(
    `  (pool ceiling = share of relevant documents present in EITHER leg's candidates. Recall\n` +
      `   above this is unreachable — no reranker can retrieve what was never a candidate.)`,
  );
  console.log("─".repeat(88));

  // ── CANDIDATE_LIMIT sweep ───────────────────────────────────────────────
  // What would raising CANDIDATE_LIMIT actually buy? Free to compute: every depth below is a
  // truncation of the same depth-DIAG_DEPTH retrieval, which is exactly what retrieving at that
  // depth returns. Quality only — the latency cost of a deeper pool is not measured here.
  const DEPTHS = [10, 20, 30, 50, 100].filter((d) => d <= DIAG_DEPTH);
  console.log(`CANDIDATE_LIMIT sweep — hybrid quality vs depth (production is ${CANDIDATE_LIMIT}):`);
  console.log(
    "  depth".padEnd(10) +
      "MRR".padEnd(8) +
      `R@${SHIPPED_K}`.padEnd(9) +
      "R@10".padEnd(9) +
      "nDCG@10".padEnd(10) +
      "pool ceiling",
  );
  for (const d of DEPTHS) {
    const at = deepTest.map((r) => atDepth(r, d));
    const lab = labelsOf(at);
    const rk = rankingsFor(at, "hybrid", weight);
    const ranked = at.map((r) => rankedDocs(r, "hybrid", weight));
    console.log(
      `  ${String(d).padEnd(8)}` +
        f2(mrr(rk, lab)).padEnd(8) +
        pct(recallAt(rk, lab, SHIPPED_K)).padEnd(9) +
        pct(recallAt(rk, lab, 10)).padEnd(9) +
        pct(ndcgAtGraded(ranked, at.map((r) => r.query), 10)).padEnd(10) +
        pct(poolCeiling(at)) +
        (d === CANDIDATE_LIMIT ? "   <- production" : ""),
    );
  }
  console.log(
    "  Quality only. A deeper pool costs latency in both legs and in the blend, which this\n" +
      "  benchmark does not measure — see the latency section of RESULTS.md.",
  );
  console.log("─".repeat(88));

  // ── how much could a perfect reranker add, at the k that ships? ─────────
  console.log(`reranker headroom at production depth ${CANDIDATE_LIMIT} — what perfect reordering would buy:`);
  console.log("  k".padEnd(8) + "hybrid R@k".padEnd(14) + "oracle rerank".padEnd(16) + "headroom".padEnd(12) + "label ceiling");
  for (const k of [SHIPPED_K, 10, CANDIDATE_LIMIT]) {
    const rk = rankingsFor(test, "hybrid", weight);
    const actual = recallAt(rk, labels, k);
    const oracle = oracleRerankAt(test, k);
    console.log(
      `  ${String(k).padEnd(6)}` +
        pct(actual).padEnd(14) +
        pct(oracle).padEnd(16) +
        (`+` + ((oracle - actual) * 100).toFixed(1) + "pp").padEnd(12) +
        pct(ceilingFor(labels, "recall", k)),
    );
  }
  console.log(
    "  oracle rerank = best recall@k achievable by reordering the pool already retrieved.\n" +
      "  headroom above it needs deeper retrieval or better candidates, not better ranking.",
  );
  console.log("─".repeat(88));

  // Graded vs binary nDCG: quantifies what the grades are actually contributing, rather than
  // assuming that a graded dataset automatically makes nDCG more informative.
  if (ds.graded) {
    console.log("graded vs binary nDCG@10 (what the relevance grades are worth):");
    for (const s of STRATEGIES) {
      const ranked = rankedByStrategy.get(s)!;
      const gradedScore = ndcgAtGraded(ranked, test.map((r) => r.query), 10);
      const flattened = test.map((r) => ({
        relevant: new Map([...r.query.relevant.keys()].map((k) => [k, 1] as [string, number])),
      }));
      const binaryScore = ndcgAtGraded(ranked, flattened, 10);
      console.log(
        `  ${s.padEnd(12)} graded ${pct(gradedScore)}   binary ${pct(binaryScore)}   ` +
          `delta ${(gradedScore - binaryScore >= 0 ? "+" : "") + ((gradedScore - binaryScore) * 100).toFixed(2)}pp`,
      );
    }
    console.log("─".repeat(88));
  }

  // ── significance ────────────────────────────────────────────────────────
  const rrOf = (s: Strategy) => {
    const rk = rankingsFor(test, s, weight);
    return rk.map((r) => (r.length > 0 ? 1 / r[0] : 0));
  };
  const rr = Object.fromEntries(STRATEGIES.map((s) => [s, rrOf(s)])) as Record<Strategy, number[]>;
  console.log("95% marginal bootstrap intervals (MRR):");
  for (const s of STRATEGIES) {
    const ci: Interval = bootstrapCI(rr[s]);
    console.log(`  ${s.padEnd(12)} ${f3(ci.value)} [${f3(ci.lo)}, ${f3(ci.hi)}]`);
  }
  console.log("\n95% paired bootstrap on per-query MRR difference:");
  for (let i = 0; i < STRATEGIES.length; i++) {
    for (let j = i + 1; j < STRATEGIES.length; j++) {
      const [a, b] = [STRATEGIES[i], STRATEGIES[j]];
      const d = bootstrapDelta(rr[a], rr[b]);
      const [x, y] = d.value >= 0 ? [a, b] : [b, a];
      const v = Math.abs(d.value);
      const [lo, hi] = d.value >= 0 ? [d.lo, d.hi] : [-d.hi, -d.lo];
      console.log(
        `  Δ MRR ${(x + " − " + y).padEnd(24)} +${f3(v)} [${f3(lo)}, ${f3(hi)}]   ` +
          `excludes zero: ${d.excludesZero ? "yes" : "no "}   ${d.excludesZero ? "SIGNIFICANT" : "not significant"}`,
      );
    }
  }
  console.log("─".repeat(88));
  console.log(`\nTotal wall time: ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(
    "\nExternal anchor: compare nDCG@10 above against the published BEIR baseline for this\n" +
      "subset. A large shortfall is a defect in this pipeline, not a configuration difference.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
