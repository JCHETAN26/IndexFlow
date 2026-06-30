/**
 * Shared retrieval evaluation harness.
 *
 * Seeds a labeled corpus inside a transaction that is ROLLED BACK, so it never touches
 * real data. Eval searches are scoped to the corpus document ids, and index scans are
 * disabled so semantic ranking is exact (brute-force KNN) rather than approximate HNSW.
 *
 * Used by the CLI (eval/run.ts) and the API route (app/api/eval/route.ts).
 */
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral } from "../lib/embed";
import { blendHybrid, type Scored } from "../lib/hybrid";
import corpus from "./corpus.json";
import queries from "./queries.json";

type Strategy = "keyword" | "semantic" | "hybrid";
type QueryKind = "exact" | "paraphrase";

interface ChunkHit {
  chunkId: string;
  docId: string;
  score: number;
}
interface QueryEval {
  kind: QueryKind;
  relevant: string[];
  kw: ChunkHit[]; // keyword candidates, ordered by score desc
  sm: ChunkHit[]; // semantic candidates, ordered by similarity desc
}

export interface StrategyMetrics {
  recall: { 1: number; 3: number; 5: number };
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
export interface EvalReport {
  numQueries: number;
  numDocs: number;
  hybridWeight: number;
  strategies: Record<Strategy, StrategyMetrics>;
  byKind: Record<QueryKind, Record<Strategy, KindMetrics>>;
  sweep: { weight: number; mrr: number }[];
  gate: GateRow[];
  passed: boolean;
}

const K_VALUES = [1, 3, 5] as const;
const SWEEP = Array.from({ length: 11 }, (_, i) => Number((i / 10).toFixed(1))); // 0.0 .. 1.0

class Rollback extends Error {}

// ── ranking helpers (pure) ────────────────────────────────────────────────
function dedupDocs(ordered: { docId: string }[]): string[] {
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
  return hybridDocs(q, weight);
}

function rankOf(docs: string[], relevant: string[]): number | null {
  const i = docs.findIndex((d) => relevant.includes(d));
  return i === -1 ? null : i + 1;
}

function recallAt(ranks: (number | null)[], k: number): number {
  if (ranks.length === 0) return 0;
  return ranks.filter((r) => r !== null && r <= k).length / ranks.length;
}
function mrr(ranks: (number | null)[]): number {
  if (ranks.length === 0) return 0;
  return ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / ranks.length;
}
function ranksFor(evals: QueryEval[], strat: Strategy, weight: number): (number | null)[] {
  return evals.map((q) => rankOf(rankedDocs(q, strat, weight), q.relevant));
}

// ── main ──────────────────────────────────────────────────────────────────
export async function runEvaluation(): Promise<EvalReport> {
  const chunks: { fileName: string; index: number; content: string; tokenCount: number }[] = [];
  for (const doc of corpus) {
    for (const c of chunkText(doc.content)) {
      chunks.push({ fileName: doc.fileName, index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }

  const chunkVecs = await embed(chunks.map((c) => c.content));
  const queryVecs = await embed(queries.map((q) => q.q));

  const evals: QueryEval[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

        const idByFile = new Map<string, string>();
        for (const doc of corpus) {
          const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
            VALUES (gen_random_uuid(), ${doc.title}, ${doc.fileName}, 'md', 'INDEXED', now(), now())
            RETURNING id::text AS id
          `;
          idByFile.set(doc.fileName, id);
        }
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          await tx.$executeRaw`
            INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
            VALUES (gen_random_uuid(), ${idByFile.get(c.fileName)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i])}::vector, now())
          `;
        }

        const corpusIds = [...idByFile.values()];

        for (let i = 0; i < queries.length; i++) {
          const query = queries[i];
          const kw = await tx.$queryRaw<ChunkHit[]>`
            SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docId",
                   ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', ${query.q})) AS score
            FROM document_chunks dc
            WHERE dc."documentId"::text = ANY(${corpusIds})
              AND to_tsvector('english', dc.content) @@ plainto_tsquery('english', ${query.q})
            ORDER BY score DESC
          `;
          const vec = toVectorLiteral(queryVecs[i]);
          const sm = await tx.$queryRaw<ChunkHit[]>`
            SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docId",
                   1 - (dc.embedding <=> ${vec}::vector) AS score
            FROM document_chunks dc
            WHERE dc."documentId"::text = ANY(${corpusIds}) AND dc.embedding IS NOT NULL
            ORDER BY dc.embedding <=> ${vec}::vector
            LIMIT 10
          `;
          // Compare against document ids, not filenames (kw/sm rows carry ids).
          const relevantIds = query.relevant.map((f) => idByFile.get(f)!);
          evals.push({ kind: query.kind as QueryKind, relevant: relevantIds, kw, sm });
        }

        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  // Weight sweep → pick the best hybrid weight by overall MRR (tie-break toward 0.5).
  const sweep = SWEEP.map((weight) => ({ weight, mrr: mrr(ranksFor(evals, "hybrid", weight)) }));
  const best = sweep.reduce((a, b) =>
    b.mrr > a.mrr || (b.mrr === a.mrr && Math.abs(b.weight - 0.5) < Math.abs(a.weight - 0.5)) ? b : a,
  );
  const weight = best.weight;

  const metricsFor = (rows: QueryEval[], strat: Strategy): StrategyMetrics => {
    const ranks = ranksFor(rows, strat, weight);
    return { recall: { 1: recallAt(ranks, 1), 3: recallAt(ranks, 3), 5: recallAt(ranks, 5) }, mrr: mrr(ranks) };
  };
  const kindMetric = (rows: QueryEval[], strat: Strategy): KindMetrics => {
    const ranks = ranksFor(rows, strat, weight);
    return { r1: recallAt(ranks, 1), mrr: mrr(ranks) };
  };

  const strategies = ["keyword", "semantic", "hybrid"] as const;
  const exact = evals.filter((e) => e.kind === "exact");
  const para = evals.filter((e) => e.kind === "paraphrase");

  const report: EvalReport = {
    numQueries: evals.length,
    numDocs: corpus.length,
    hybridWeight: weight,
    strategies: Object.fromEntries(strategies.map((s) => [s, metricsFor(evals, s)])) as Record<
      Strategy,
      StrategyMetrics
    >,
    byKind: {
      exact: Object.fromEntries(strategies.map((s) => [s, kindMetric(exact, s)])) as Record<Strategy, KindMetrics>,
      paraphrase: Object.fromEntries(strategies.map((s) => [s, kindMetric(para, s)])) as Record<Strategy, KindMetrics>,
    },
    sweep,
    gate: [],
    passed: true,
  };

  // Quality gate. Floors sit below current numbers to catch regressions, not variance.
  const gate: GateRow[] = [
    g("keyword R@1 on exact", report.byKind.exact.keyword.r1, 0.5),
    g("semantic R@1 on paraphrase", report.byKind.paraphrase.semantic.r1, 0.7),
    g("hybrid R@5 overall", report.strategies.hybrid.recall[5], 0.9),
    g("hybrid MRR ≥ best single", report.strategies.hybrid.mrr, Math.max(report.strategies.keyword.mrr, report.strategies.semantic.mrr) - 0.02),
  ];
  report.gate = gate;
  report.passed = gate.every((r) => r.pass);
  return report;
}

function g(name: string, value: number, floor: number): GateRow {
  return { name, value, floor, pass: value >= floor };
}
