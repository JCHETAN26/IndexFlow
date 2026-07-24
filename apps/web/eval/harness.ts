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
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral } from "../lib/embed";
import { blendHybrid, type Scored } from "../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../lib/es";
import { rerank } from "../lib/rerank";
import corpus from "./corpus.json";
import queries from "./queries.json";

type Strategy = "keyword" | "semantic" | "hybrid" | "hybrid+rerank";
type QueryKind = "exact" | "paraphrase";

interface ChunkHit {
  chunkId: string;
  docId: string;
  score: number;
  snippet?: string;
}
interface QueryEval {
  queryText: string;
  kind: QueryKind;
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
export interface EvalReport {
  numQueries: number;
  numDocs: number;
  hybridWeight: number;
  strategies: Record<Strategy, StrategyMetrics>;
  byKind: Record<QueryKind, Record<Strategy, KindMetrics>>;
  sweep: { weight: number; mrr: number }[];
  regressions: Regression[];
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
  if (strat === "hybrid+rerank" && q.hybridRerankDocs) return q.hybridRerankDocs;
  return hybridDocs(q, weight);
}

function ranksForQuery(docs: string[], relevant: string[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (relevant.includes(docs[i])) r.push(i + 1);
  }
  return r;
}

function recallAt(rankings: number[][], evals: QueryEval[], k: number): number {
  if (rankings.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    const total = evals[i].relevant.length;
    if (total === 0) continue;
    sum += rankings[i].filter(r => r <= k).length / total;
  }
  return sum / rankings.length;
}

function mrr(rankings: number[][]): number {
  if (rankings.length === 0) return 0;
  return rankings.reduce<number>((s, r) => s + (r.length > 0 ? 1 / r[0] : 0), 0) / rankings.length;
}

function precisionAt(rankings: number[][], k: number): number {
  if (rankings.length === 0) return 0;
  return rankings.reduce<number>((sum, r) => sum + r.filter(x => x <= k).length / k, 0) / rankings.length;
}

function ndcgAt(rankings: number[][], evals: QueryEval[], k: number): number {
  if (rankings.length === 0) return 0;
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
  return sum / rankings.length;
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
            evals.push({ queryText: query.q, kind: query.kind as QueryKind, relevant: relevantIds, kw: kwByQuery[i], sm });
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

  // Weight sweep → pick the best hybrid weight by overall MRR (tie-break toward 0.5).
  const sweep = SWEEP.map((weight) => ({ weight, mrr: mrr(ranksFor(evals, "hybrid", weight)) }));
  const best = sweep.reduce((a, b) =>
    b.mrr > a.mrr || (b.mrr === a.mrr && Math.abs(b.weight - 0.5) < Math.abs(a.weight - 0.5)) ? b : a,
  );
  const weight = best.weight;

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
        candidatesForRerank.push({ ...c, title: "", fileType: "md", snippet: c.snippet ?? "" });
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
      precision: { 3: precisionAt(ranks, 3) },
      ndcg: { 5: ndcgAt(ranks, rows, 5) },
      mrr: mrr(ranks) 
    };
  };
  const kindMetric = (rows: QueryEval[], strat: Strategy): KindMetrics => {
    const ranks = ranksFor(rows, strat, weight);
    return { r1: recallAt(ranks, rows, 1), mrr: mrr(ranks) };
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
    regressions,
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
