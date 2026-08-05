/**
 * Scale + latency benchmark for the retrieval path.
 *
 * Generates a SYNTHETIC corpus (random 384-dim unit vectors + text drawn from a fixed
 * vocabulary) at several scales, loads it into a dedicated `bench_chunks` table with a real
 * pgvector HNSW index and an ephemeral Elasticsearch index, then measures query latency
 * (p50/p95/p99/mean) for keyword / semantic / hybrid — the same index types and query shapes
 * the production retriever uses (lib/retrieve, lib/es), isolated so it never touches real data.
 *
 * Scope / honesty:
 *   - Measures retrieval LATENCY at scale, not retrieval QUALITY (vectors are synthetic;
 *     quality is covered by eval/harness.ts). BM25 latency is real (real text + real index).
 *   - "Index throughput" is BULK-load throughput (COPY-style batched writes), not end-to-end
 *     BullMQ ingestion (which would take hours on a laptop). Labeled as such.
 *   - A minimal `is_public` predicate mirrors the shape of the production ACL filter without
 *     the grant-table joins (all rows public), so numbers are a lower bound on ACL overhead.
 *
 * Run: pnpm --filter @indexflow/web bench:latency
 *   BENCH_SCALES=1000,10000,50000,100000  BENCH_QUERIES=200  pnpm ... bench:latency
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "../lib/hybrid";
import {
  createEphemeralIndex,
  deleteIndex,
  indexChunks,
  keywordSearch,
  type EsChunk,
} from "../lib/es";

// Logging-silent client: the eval prisma singleton logs every query, which is brutal when
// inserting vectors; a quiet client keeps load timing honest.
const db = new PrismaClient({ log: [] });

const DIM = 384;
const K = 10; // results returned
const CANDIDATE_LIMIT = 30; // per-leg candidates, mirrors lib/retrieve CANDIDATE_LIMIT
const SCALES = (process.env.BENCH_SCALES ?? "1000,10000,50000").split(",").map((s) => Number(s.trim()));
const QUERIES = Number(process.env.BENCH_QUERIES ?? 200);
const WARMUP = 20;
/**
 * Independent repeats per scale. One run reports a percentile without an error bar, which on a
 * shared CI runner is indistinguishable from noise — the brief asks for run-to-run spread, and a
 * p50 that moves 3ms between identical runs should not be read as a 3ms difference.
 */
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const LOAD_BATCH = 500;

// Small fixed vocabulary so BM25 has real terms to match/rank.
const VOCAB =
  `search index vector embedding latency throughput cluster shard replica query cache token ` +
  `retrieval ranking relevance document chunk pipeline worker queue backoff retry ingest upload ` +
  `postgres elasticsearch redis storage bucket schema migration cosine similarity keyword semantic ` +
  `hybrid blend weight recall precision faithfulness citation refusal permission access control grant ` +
  `owner group public private session auth oauth timeout deadline circuit breaker connection pool ` +
  `memory heap gc throughput histogram percentile benchmark synthetic corpus scale bottleneck`.split(
    /\s+/,
  );

const rand = (n: number) => Math.floor(Math.random() * n);
const word = () => VOCAB[rand(VOCAB.length)];
const synthText = (n = 90) => Array.from({ length: n }, word).join(" ");
const queryText = () => Array.from({ length: 3 }, word).join(" ");

function randUnitVec(): number[] {
  const v = new Array<number>(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    const x = Math.random() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}
const vecLiteral = (v: number[]) => `[${v.join(",")}]`;

function pct(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number) => Math.round(n * 10) / 10;

interface Row {
  scale: number;
  annRecall: number;
  /** p50 of each independent repeat, so run-to-run spread is visible. */
  repeatP50: { keyword: number[]; semantic: number[]; hybrid: number[] };
  loadPgPerSec: number;
  loadEsPerSec: number;
  hnswBuildMs: number;
  keyword: number[];
  semantic: number[];
  hybrid: number[];
}

async function setupPg() {
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS bench_chunks`);
  await db.$executeRawUnsafe(
    `CREATE TABLE bench_chunks (id uuid PRIMARY KEY, content text NOT NULL, embedding vector(${DIM}) NOT NULL, is_public boolean NOT NULL DEFAULT true)`,
  );
}
async function dropPg() {
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS bench_chunks`).catch(() => {});
}

// Load N synthetic vectors into Postgres, generated SERVER-SIDE (no data shipped from Node).
// Cosine distance is scale-invariant, so unnormalized random vectors are fine for latency.
// A LATERAL subquery re-evaluates random() per row, giving each row a distinct vector.
async function loadPg(n: number): Promise<number> {
  const PG_BATCH = 5000;
  let ms = 0;
  for (let start = 0; start < n; start += PG_BATCH) {
    const count = Math.min(PG_BATCH, n - start);
    const t = performance.now();
    await db.$executeRawUnsafe(
      `INSERT INTO bench_chunks (id, content, embedding, is_public)
       SELECT gen_random_uuid(), '', v, true
       FROM generate_series(1, ${count}) s
       CROSS JOIN LATERAL (
         SELECT ('[' || string_agg((random() * 2 - 1)::text, ',') || ']')::vector AS v
         FROM generate_series(1, ${DIM})
       ) t`,
    );
    ms += performance.now() - t;
  }
  return n / (ms / 1000);
}

// Load N synthetic text docs into the ephemeral ES index (real text so BM25 is meaningful).
async function loadEs(n: number, esIndex: string): Promise<number> {
  let ms = 0;
  for (let start = 0; start < n; start += LOAD_BATCH) {
    const count = Math.min(LOAD_BATCH, n - start);
    const batch: EsChunk[] = Array.from({ length: count }, () => {
      const id = randomUUID();
      return { chunkId: id, documentId: id, chunkIndex: 0, title: "bench", fileType: "md", content: synthText(), acl: ["public"] };
    });
    const last = start + LOAD_BATCH >= n;
    const t = performance.now();
    await indexChunks(batch, esIndex, last ? "wait_for" : false);
    ms += performance.now() - t;
  }
  return n / (ms / 1000);
}

async function buildHnsw(): Promise<number> {
  const t = performance.now();
  await db.$executeRawUnsafe(
    `CREATE INDEX bench_hnsw ON bench_chunks USING hnsw (embedding vector_cosine_ops)`,
  );
  await db.$executeRawUnsafe(`ANALYZE bench_chunks`);
  return performance.now() - t;
}

async function semanticQuery(vec: number[]): Promise<Scored[]> {
  const lit = vecLiteral(vec);
  const rows = await db.$queryRawUnsafe<{ id: string; score: number }[]>(
    `SELECT id::text AS id, 1 - (embedding <=> '${lit}'::vector) AS score
     FROM bench_chunks
     WHERE is_public
     ORDER BY embedding <=> '${lit}'::vector
     LIMIT ${CANDIDATE_LIMIT}`,
  );
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}
async function keywordQuery(q: string, esIndex: string): Promise<Scored[]> {
  const hits = await keywordSearch(q, null, CANDIDATE_LIMIT, esIndex, ["public"]);
  return hits.map((h) => ({ id: h.chunkId, score: h.score }));
}

// Time a single async call in ms.
async function timed<T>(fn: () => Promise<T>): Promise<number> {
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

/**
 * Measure the three strategies without letting any of them warm the caches for another.
 *
 * The previous implementation ran keyword, then semantic, then hybrid — in that fixed order, on
 * the SAME query text and vector, every iteration. By the time hybrid ran, Elasticsearch had just
 * served that exact query and Postgres had just executed that exact vector scan, so both of
 * hybrid's legs were answered from caches the two standalone measurements had populated. That is
 * why the published table showed hybrid p50 *below* keyword p50 at three of four scales, which is
 * impossible for a strategy that awaits both legs. The number was an artifact of measurement
 * order, not a property of the system.
 *
 * Two changes: every (trial, strategy) pair gets its **own** query, so no strategy inherits
 * another's warm cache; and the order of the three strategies is **shuffled per trial**, so any
 * residual position effect is spread evenly instead of always favouring whatever ran last.
 */
async function measure(esIndex: string) {
  const kw: number[] = [];
  const sm: number[] = [];
  const hy: number[] = [];

  const runOne = async (strategy: "keyword" | "semantic" | "hybrid"): Promise<number> => {
    // A fresh query per measurement. Reusing one across strategies is what created the artifact.
    const qs = queryText();
    const qv = randUnitVec();
    if (strategy === "keyword") return timed(() => keywordQuery(qs, esIndex));
    if (strategy === "semantic") return timed(() => semanticQuery(qv));
    return timed(async () => {
      const [k, s] = await Promise.all([keywordQuery(qs, esIndex), semanticQuery(qv)]);
      blendHybrid(k, s, DEFAULT_HYBRID_WEIGHT).slice(0, K);
    });
  };

  for (let i = 0; i < QUERIES + WARMUP; i++) {
    const warm = i < WARMUP;
    const order: ("keyword" | "semantic" | "hybrid")[] = ["keyword", "semantic", "hybrid"];
    for (let j = order.length - 1; j > 0; j--) {
      const r = rand(j + 1);
      [order[j], order[r]] = [order[r], order[j]];
    }
    for (const strategy of order) {
      const ms = await runOne(strategy);
      if (warm) continue;
      if (strategy === "keyword") kw.push(ms);
      else if (strategy === "semantic") sm.push(ms);
      else hy.push(ms);
    }
  }
  return { keyword: kw.sort((a, b) => a - b), semantic: sm.sort((a, b) => a - b), hybrid: hy.sort((a, b) => a - b) };
}

/**
 * ANN recall against exact KNN.
 *
 * HNSW trades recall for speed and the benchmark previously measured only the speed half, which
 * makes a fast p50 unfalsifiable — an index that returns the wrong neighbours instantly would look
 * excellent. For each sampled query the approximate top-k (index scan on, as production runs) is
 * compared against the exact top-k (sequential scan forced), and the overlap reported.
 */
async function annRecall(samples = 50): Promise<number> {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const lit = vecLiteral(randUnitVec());
    const approx = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text AS id FROM bench_chunks ORDER BY embedding <=> '${lit}'::vector LIMIT ${K}`,
    );
    // Force the exact answer by disabling index scans for this statement only.
    const exact = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
      await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
      return tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text AS id FROM bench_chunks ORDER BY embedding <=> '${lit}'::vector LIMIT ${K}`,
      );
    });
    const exactIds = new Set(exact.map((r) => r.id));
    sum += approx.filter((r) => exactIds.has(r.id)).length / Math.max(1, exactIds.size);
  }
  return sum / samples;
}

function fmtStats(name: string, ms: number[]): string {
  return `${name.padEnd(9)} p50 ${String(round(pct(ms, 50))).padStart(7)}  p95 ${String(round(pct(ms, 95))).padStart(7)}  p99 ${String(round(pct(ms, 99))).padStart(7)}  mean ${String(round(mean(ms))).padStart(7)}  (ms)`;
}

async function main() {
  console.log(`scales: ${SCALES.join(", ")} · queries/scale: ${QUERIES} (+${WARMUP} warmup) · dim ${DIM} · k ${K}\n`);
  const results: Row[] = [];
  for (const n of SCALES) {
    console.log(`── scale ${n.toLocaleString()} chunks ──`);
    const esIndex = await createEphemeralIndex("indexflow_bench");
    try {
      await setupPg();
      const [pgPerSec, esPerSec] = await Promise.all([loadPg(n), loadEs(n, esIndex)]);
      const hnswMs = await buildHnsw();
      console.log(
        `  loaded: pg ${Math.round(pgPerSec).toLocaleString()}/s · es ${Math.round(esPerSec).toLocaleString()}/s · hnsw build ${round(hnswMs)}ms`,
      );
      const recall = await annRecall();
      console.log(`  ANN recall@${K} vs exact KNN: ${(recall * 100).toFixed(1)}%`);

      // Independent repeats. Pooled samples give the headline percentiles; per-run p50s give the
      // spread, which is what says whether a difference between scales is real.
      const pooled = { keyword: [] as number[], semantic: [] as number[], hybrid: [] as number[] };
      const repeatP50 = { keyword: [] as number[], semantic: [] as number[], hybrid: [] as number[] };
      for (let run = 0; run < REPEATS; run++) {
        const m = await measure(esIndex);
        for (const mode of ["keyword", "semantic", "hybrid"] as const) {
          pooled[mode].push(...m[mode]);
          repeatP50[mode].push(pct(m[mode], 50));
        }
      }
      for (const mode of ["keyword", "semantic", "hybrid"] as const) pooled[mode].sort((a, b) => a - b);

      for (const mode of ["keyword", "semantic", "hybrid"] as const) {
        const spread = repeatP50[mode].map((v) => round(v)).join(" / ");
        console.log(`  ${fmtStats(mode, pooled[mode])}   per-run p50: ${spread}`);
      }
      // Sanity check the measurement itself: hybrid awaits both legs, so its p50 cannot be below
      // the slower leg's p50. If it is, the numbers are an artifact and must not be published.
      const slowestLeg = Math.max(pct(pooled.keyword, 50), pct(pooled.semantic, 50));
      if (pct(pooled.hybrid, 50) < slowestLeg) {
        console.log(
          `  WARNING  hybrid p50 (${round(pct(pooled.hybrid, 50))}ms) is below the slower leg ` +
            `(${round(slowestLeg)}ms). Hybrid awaits both legs, so this is impossible — treat these ` +
            `latency numbers as an artifact, not a measurement.`,
        );
      }

      results.push({
        scale: n,
        annRecall: recall,
        repeatP50,
        loadPgPerSec: pgPerSec,
        loadEsPerSec: esPerSec,
        hnswBuildMs: hnswMs,
        keyword: pooled.keyword,
        semantic: pooled.semantic,
        hybrid: pooled.hybrid,
      });
    } finally {
      await deleteIndex(esIndex).catch(() => {});
      await dropPg();
    }
    console.log("");
  }

  // ---- write a scratch markdown artifact ----
  // NOT committed. eval/RESULTS.md is the single source of truth for every published number;
  // this file is a convenience copy for pasting a fresh run into it. See eval/RESULTS.md.
  const lines: string[] = [];
  lines.push("# Retrieval latency & scale benchmark\n");
  lines.push(
    `> Synthetic corpus (random ${DIM}-dim unit vectors + fixed-vocabulary text), isolated \`bench_chunks\` table with a real pgvector HNSW index + an ephemeral Elasticsearch index. Measures retrieval **latency** (not quality). ${QUERIES} queries/scale after ${WARMUP} warmup. Generated by \`apps/web/bench/latency-bench.ts\`.\n`,
  );
  lines.push(`Machine: local Docker (Postgres/pgvector, Elasticsearch 8, 512MB heap). Node ${process.version}.\n`);
  lines.push(`## Query latency (ms)\n`);
  lines.push(`| Scale (chunks) | Mode | p50 | p95 | p99 | mean | per-run p50 (${REPEATS} runs) |`);
  lines.push(`|---:|---|---:|---:|---:|---:|---|`);
  for (const r of results) {
    for (const mode of ["keyword", "semantic", "hybrid"] as const) {
      const ms = r[mode];
      lines.push(
        `| ${r.scale.toLocaleString()} | ${mode} | ${round(pct(ms, 50))} | ${round(pct(ms, 95))} | ${round(pct(ms, 99))} | ${round(mean(ms))} | ${r.repeatP50[mode].map((v) => round(v)).join(" / ")} |`,
      );
    }
  }
  lines.push(`\n## ANN recall vs exact KNN\n`);
  lines.push(`> HNSW trades recall for speed. A fast p50 means nothing without this column.\n`);
  lines.push(`| Scale (chunks) | ANN recall@${K} |`);
  lines.push(`|---:|---:|`);
  for (const r of results) {
    lines.push(`| ${r.scale.toLocaleString()} | ${(r.annRecall * 100).toFixed(1)}% |`);
  }
  lines.push(`\n## Bulk index throughput (synthetic, not BullMQ)\n`);
  lines.push(`| Scale (chunks) | Postgres rows/s | Elasticsearch docs/s | HNSW build (ms) |`);
  lines.push(`|---:|---:|---:|---:|`);
  for (const r of results) {
    lines.push(
      `| ${r.scale.toLocaleString()} | ${Math.round(r.loadPgPerSec).toLocaleString()} | ${Math.round(r.loadEsPerSec).toLocaleString()} | ${round(r.hnswBuildMs)} |`,
    );
  }
  lines.push("");
  const outDir = new URL("../../../.evalrun/", import.meta.url).pathname;
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}bench-latency.md`;
  writeFileSync(outPath, lines.join("\n"));
  console.log(`scratch copy written to ${outPath}`);
  console.log(`to publish these numbers, paste the output above into apps/web/eval/RESULTS.md`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    await dropPg();
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
