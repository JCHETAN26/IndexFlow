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

async function measure(esIndex: string) {
  const qStrings = Array.from({ length: QUERIES + WARMUP }, queryText);
  const qVecs = Array.from({ length: QUERIES + WARMUP }, randUnitVec);

  const kw: number[] = [];
  const sm: number[] = [];
  const hy: number[] = [];
  for (let i = 0; i < QUERIES + WARMUP; i++) {
    const warm = i < WARMUP;
    const kMs = await timed(() => keywordQuery(qStrings[i], esIndex));
    const sMs = await timed(() => semanticQuery(qVecs[i]));
    const hMs = await timed(async () => {
      const [k, s] = await Promise.all([keywordQuery(qStrings[i], esIndex), semanticQuery(qVecs[i])]);
      blendHybrid(k, s, DEFAULT_HYBRID_WEIGHT).slice(0, K);
    });
    if (!warm) {
      kw.push(kMs);
      sm.push(sMs);
      hy.push(hMs);
    }
  }
  return { keyword: kw.sort((a, b) => a - b), semantic: sm.sort((a, b) => a - b), hybrid: hy.sort((a, b) => a - b) };
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
      const m = await measure(esIndex);
      console.log("  " + fmtStats("keyword", m.keyword));
      console.log("  " + fmtStats("semantic", m.semantic));
      console.log("  " + fmtStats("hybrid", m.hybrid));
      results.push({
        scale: n,
        loadPgPerSec: pgPerSec,
        loadEsPerSec: esPerSec,
        hnswBuildMs: hnswMs,
        keyword: m.keyword,
        semantic: m.semantic,
        hybrid: m.hybrid,
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
  lines.push(`| Scale (chunks) | Mode | p50 | p95 | p99 | mean |`);
  lines.push(`|---:|---|---:|---:|---:|---:|`);
  for (const r of results) {
    for (const mode of ["keyword", "semantic", "hybrid"] as const) {
      const ms = r[mode];
      lines.push(
        `| ${r.scale.toLocaleString()} | ${mode} | ${round(pct(ms, 50))} | ${round(pct(ms, 95))} | ${round(pct(ms, 99))} | ${round(mean(ms))} |`,
      );
    }
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
