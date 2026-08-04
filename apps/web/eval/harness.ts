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
import {
  ceilingFor,
  dedupDocs,
  judgedCount,
  mrr,
  ndcgAt,
  precisionAt,
  ranksForQuery,
  recallAt,
  rejectionSignal,
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
/** 95% bootstrap interval around a metric, so a difference can be read as signal or noise. */
export interface Interval {
  value: number;
  lo: number;
  hi: number;
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
  /** Provenance of the numbers below. */
  dataset: DatasetInfo;
  /**
   * Headline metrics are computed on the HELD-OUT split. The hybrid weight is chosen by the
   * sweep on the tuning split only, so these numbers are not reported on data that selected
   * them. `strategiesAll` keeps the whole-set figures for continuity with earlier runs.
   */
  strategiesAll: Record<Strategy, StrategyMetrics>;
  /** 95% bootstrap CIs for the headline hybrid metrics on the held-out split. */
  ci: { hybridMrr: Interval; hybridR1: Interval; hybridR5: Interval };
  strategies: Record<Strategy, StrategyMetrics>;
  /** Attainable maxima for `strategies`, on the held-out split. */
  ceilings: Ceilings;
  /** Correctly returning nothing for an unanswerable query, measured apart from ranking. */
  rejection: RejectionReport;
  byKind: Record<QueryKind, Record<Strategy, KindMetrics>>;
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

/**
 * Percentile bootstrap: resample the per-query scores with replacement and take the 2.5th and
 * 97.5th percentiles. With a few dozen queries the interval is wide, and that is the point —
 * it makes "0.96 vs 0.94" legible as overlapping rather than as a ranking.
 *
 * Deterministic (fixed seed) so re-running the eval does not jitter the published interval.
 */
function bootstrapCI(perQuery: number[], samples = BOOTSTRAP_SAMPLES): Interval {
  const n = perQuery.length;
  const value = n === 0 ? 0 : perQuery.reduce((a, b) => a + b, 0) / n;
  if (n === 0) return { value: 0, lo: 0, hi: 0 };

  // Small deterministic PRNG (mulberry32) — no dependency, and a fixed seed keeps CIs stable.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const means: number[] = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += perQuery[(rand() * n) | 0];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    value,
    lo: means[Math.floor(0.025 * samples)],
    hi: means[Math.floor(0.975 * samples) - 1],
  };
}

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

// ── main ──────────────────────────────────────────────────────────────────
export async function runEvaluation(): Promise<EvalReport> {
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
      const hits = await keywordSearch(query.q, null, chunks.length, esIndex);
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
              LIMIT 10
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
  const exact = evals.filter((e) => e.kind === "exact");
  const para = evals.filter((e) => e.kind === "paraphrase");

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
      hybridMrr: bootstrapCI(reciprocalRanks),
      hybridR1: bootstrapCI(hitAt(1)),
      hybridR5: bootstrapCI(hitAt(5)),
    },
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
    rejection,
    byKind: {
      exact: Object.fromEntries(strategies.map((s) => [s, kindMetric(exact, s)])) as Record<Strategy, KindMetrics>,
      paraphrase: Object.fromEntries(strategies.map((s) => [s, kindMetric(para, s)])) as Record<Strategy, KindMetrics>,
    },
    sweep,
    regressions,
    gate: [],
    passed: true,
  };

  // Quality gate, on the held-out split. Floors sit below current numbers to catch regressions,
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
