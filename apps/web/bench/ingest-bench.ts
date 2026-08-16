/**
 * Phase 9c: end-to-end ingestion throughput, through the real pipeline.
 *
 * The "index throughput" figure published so far is **bulk-load** speed — batched writes straight
 * into Postgres and Elasticsearch. Nothing a user does goes through that path. Real ingestion is
 * upload → MinIO → BullMQ → worker → download → extract → chunk → embed → Postgres transaction →
 * outbox → Elasticsearch projection, and it is slower by orders of magnitude. Publishing the
 * bulk number as "ingestion" overstates the system by roughly that factor.
 *
 * This drives the actual `ingestDocument` through an actual BullMQ `Worker` against real Redis,
 * MinIO, Postgres and Elasticsearch — the same function the production worker calls — at several
 * concurrency levels, and separately times each stage so the bottleneck is identified rather than
 * guessed.
 *
 * Run: pnpm --filter @indexflow/web bench:ingest
 *   INGEST_DOCS=60 INGEST_CONCURRENCY=1,2,4,8 pnpm ... bench:ingest
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Queue, Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { putObject, storageKeyFor } from "../lib/storage";
import { ingestDocument } from "../lib/ingest";
import { connection } from "../lib/queue";
import { extractText } from "../lib/extract";
import { chunkText } from "../lib/chunk";
import { embed } from "../lib/embed";
import { getObject } from "../lib/storage";
import { ensureChunkIndex, deleteDocumentChunks, es, CHUNK_INDEX } from "../lib/es";

const NUM_DOCS = Number(process.env.INGEST_DOCS ?? 40);
/** Discarded before the measured runs, purely to warm the model, caches and JIT. */
const WARMUP_DOCS = Number(process.env.INGEST_WARMUP_DOCS ?? 10);
const CONCURRENCIES = (process.env.INGEST_CONCURRENCY ?? "1,2,4,8")
  .split(",")
  .map((s) => Number(s.trim()));
const QUEUE_NAME = "ingestion-bench";
const TAG = "[ingest-bench]";

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const p50 = (xs: number[]) => pct(xs, 50);
const median = (xs: number[]) => pct(xs, 50);

/** Independent passes over the whole concurrency sweep. One run is an anecdote. */
const REPEATS = Number(process.env.INGEST_REPEATS ?? 3);
/** Ratio of fastest to slowest pass beyond which a run is reported as contaminated, not as data. */
const SPREAD_LIMIT = Number(process.env.INGEST_SPREAD_LIMIT ?? 1.25);

/**
 * Elasticsearch's own refresh counters, read straight off the index.
 *
 * The stage breakdown below attributes the write path by subtraction, which is an estimate — and
 * the first version of that estimate was wrong by 89 percentage points. These counters are not an
 * estimate: they are what the engine did. Refreshes-per-document is the number the projection path
 * is trying to move, so measuring it directly means a throughput change can be attributed rather
 * than argued about.
 */
async function refreshStats(): Promise<{ total: number; totalMs: number }> {
  try {
    const res = await es().indices.stats({ index: CHUNK_INDEX, metric: "refresh" });
    const r = res._all?.total?.refresh;
    return { total: r?.total ?? 0, totalMs: r?.total_time_in_millis ?? 0 };
  } catch {
    return { total: 0, totalMs: 0 };
  }
}

/**
 * Document bodies of a realistic size. The pipeline's cost is dominated by embedding, which scales
 * with chunk count, so a corpus of one-line documents would report a throughput no real upload
 * could achieve.
 */
const WORDS =
  `incident retrieval latency deploy rollback index shard replica embedding vector queue worker ` +
  `postgres elasticsearch redis storage bucket migration timeout retry backoff permission grant ` +
  `owner group audit session token refresh outage degradation mitigation postmortem runbook alert`.split(
    /\s+/,
  );
const body = (words: number) =>
  Array.from({ length: words }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join(" ");

interface Seeded {
  id: string;
  jobId: string;
}

async function seed(n: number, ownerId: string): Promise<Seeded[]> {
  const out: Seeded[] = [];
  for (let i = 0; i < n; i++) {
    const fileName = `bench-${randomUUID()}.md`;
    const doc = await prisma.document.create({
      data: {
        title: `Bench doc ${i}`,
        fileName,
        fileType: "md",
        status: "UPLOADED",
        isPublic: true,
        ownerId,
      },
      select: { id: true },
    });
    // ~450 words → roughly 3 chunks at the 180-word target, a realistic upload.
    const key = storageKeyFor(doc.id, fileName);
    await putObject(key, Buffer.from(body(450), "utf8"), "text/markdown");
    await prisma.document.update({ where: { id: doc.id }, data: { storageKey: key } });
    const job = await prisma.ingestionJob.create({
      data: { documentId: doc.id, status: "QUEUED" },
      select: { id: true },
    });
    out.push({ id: doc.id, jobId: job.id });
  }
  return out;
}

async function cleanup(docs: Seeded[]) {
  for (const d of docs) {
    await deleteDocumentChunks(d.id, undefined, true).catch(() => {});
    await prisma.$executeRaw`DELETE FROM document_chunks WHERE "documentId" = ${d.id}::uuid`.catch(() => {});
    await prisma.ingestionJob.deleteMany({ where: { documentId: d.id } }).catch(() => {});
    await prisma.document.delete({ where: { id: d.id } }).catch(() => {});
  }
}

/**
 * Time each stage, to attribute the throughput number to a cause rather than guessing.
 *
 * The write stages cannot be timed by subtracting from a full `ingestDocument` run on the same
 * document: `ingestDocument` redoes the download, chunk and embed itself, so the subtraction lands
 * near zero and reports "the database is free", which is an artifact. Instead the read/CPU stages
 * are timed directly on one document and a full ingest is timed on a second, identical-sized one,
 * with the model already warm in both. The difference is then the write path.
 */
async function stageBreakdown(ownerId: string) {
  // Warm the ONNX model first; otherwise its one-off load (seconds) is attributed to embedding.
  await embed(["warmup"]);

  const [a, b] = await seed(2, ownerId);
  const rowA = await prisma.document.findUnique({
    where: { id: a.id },
    select: { storageKey: true, fileType: true },
  });

  const t: Record<string, number> = {};
  let mark = performance.now();
  const lap = (k: string) => {
    t[k] = performance.now() - mark;
    mark = performance.now();
  };

  const { body: stream } = await getObject(rowA!.storageKey!);
  lap("minio download");
  const text = await extractText(stream, rowA!.fileType);
  lap("extract");
  const chunks = chunkText(text);
  lap("chunk");
  await embed(chunks.map((c) => c.content));
  lap("embed");
  const readSide = t["minio download"] + t.extract + t.chunk + t.embed;

  // Second document, same size, model warm: a full ingest minus the read side is the write side.
  const full = performance.now();
  await ingestDocument(b.id);
  const fullMs = performance.now() - full;
  t["postgres txn + outbox + ES projection"] = Math.max(0, fullMs - readSide);

  await cleanup([a, b]);
  return { stages: t, chunks: chunks.length, totalMs: fullMs };
}

async function runAtConcurrency(concurrency: number, ownerId: string, numDocs = NUM_DOCS) {
  const docs = await seed(numDocs, ownerId);
  const queue = new Queue(QUEUE_NAME, { connection });
  await queue.drain(true).catch(() => {});

  const perDoc: number[] = [];
  let completed = 0;
  let failed = 0;
  let resolveAll: () => void;
  const allDone = new Promise<void>((r) => (resolveAll = r));

  const worker = new Worker<{ documentId: string; jobId: string }>(
    QUEUE_NAME,
    async (job) => {
      const t = performance.now();
      await ingestDocument(job.data.documentId);
      perDoc.push(performance.now() - t);
    },
    { connection, concurrency },
  );
  worker.on("completed", () => {
    if (++completed + failed >= numDocs) resolveAll();
  });
  worker.on("failed", (_j, err) => {
    failed++;
    console.error(`${TAG} job failed: ${err.message}`);
    if (completed + failed >= numDocs) resolveAll();
  });

  const before = await refreshStats();
  const start = performance.now();
  await queue.addBulk(
    docs.map((d) => ({ name: "ingest", data: { documentId: d.id, jobId: d.jobId } })),
  );
  await allDone;
  const wallMs = performance.now() - start;
  const after = await refreshStats();

  await worker.close();
  await queue.close();
  await cleanup(docs);

  return {
    concurrency,
    wallSeconds: wallMs / 1000,
    docsPerSec: numDocs / (wallMs / 1000),
    perDocP50Ms: p50(perDoc),
    perDocP95Ms: pct(perDoc, 95),
    refreshes: after.total - before.total,
    refreshMs: after.totalMs - before.totalMs,
    failed,
  };
}

async function main() {
  await ensureChunkIndex();
  const owner = await prisma.user.create({
    data: { name: `${TAG} owner`, email: `${randomUUID()}@bench.test` },
    select: { id: true },
  });

  try {
    console.log(`\n${TAG} end-to-end ingestion through the real BullMQ worker`);
    console.log(`  ${NUM_DOCS} documents per run · concurrency levels: ${CONCURRENCIES.join(", ")}`);
    console.log(`  path: MinIO download -> extract -> chunk -> embed -> Postgres txn -> outbox -> ES`);

    // Environment, recorded with the numbers rather than remembered alongside them. A throughput
    // figure means nothing without the machine, the configuration and the load it was taken under,
    // and "which settings was that run?" is not a question worth answering from memory once there
    // are four builds to compare.
    const os = await import("node:os");
    const esInfo = await es().info().catch(() => null);
    console.log(
      `\n  environment: node ${process.version} · ${os.cpus().length} logical CPUs · ` +
        `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB RAM · load ${os
          .loadavg()
          .map((n) => n.toFixed(2))
          .join(" ")}`,
    );
    console.log(
      `  config: elasticsearch ${esInfo?.version?.number ?? "?"} · ` +
        `projection refresh=${process.env.PROJECTION_REFRESH ?? "true (default)"} · ` +
        `coalesce=${process.env.PROJECTION_COALESCE_MS ?? "0 (default)"}ms · ` +
        `${REPEATS} passes\n`,
    );

    // Discarded warmup. Without it the first measured run pays for everything cold underneath it —
    // the ONNX model load, an unJITed process, cold Elasticsearch and Postgres page caches, a
    // Docker VM that has only just started — and reports a throughput the pipeline never has
    // again. Measured on this machine: the first run came in at 0.44 docs/s with a p95 of 11.6 s
    // against a p50 of 1.1 s, then every later run settled near 1.0 s at both percentiles. Since
    // the runs execute in a fixed order, that cost lands entirely on the concurrency-1 row and
    // inflates every speedup computed against it. This is the same measurement-order defect the
    // latency benchmark had in Phase 9b, in a different place.
    // Warm EVERY concurrency level, not just one. Warming only at max concurrency left the
    // concurrency-1 path cold, and concurrency 1 is measured first — so the ramp landed entirely
    // on the row that anchors every speedup. It showed up on CI as passes of 5.01 / 6.57 / 6.70
    // docs/s at concurrency 1 while the other three levels agreed to within 10%, with the warmup
    // itself running at 2.93 docs/s against a 6.57 steady state: still cold when it finished.
    process.stdout.write("warming up (discarded)... ");
    const warm: number[] = [];
    for (const c of CONCURRENCIES) {
      warm.push((await runAtConcurrency(c, owner.id, WARMUP_DOCS)).docsPerSec);
    }
    console.log(`${warm.map((d) => round(d).toFixed(2)).join("  ")} docs/s (not reported)\n`);

    console.log("stage breakdown (single document, warm):");
    const bd = await stageBreakdown(owner.id);
    const total = Object.values(bd.stages).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(bd.stages).sort((a, b) => b[1] - a[1])) {
      const share = (v / total) * 100;
      console.log(`  ${k.padEnd(36)} ${round(v).toFixed(1).padStart(8)} ms   ${share.toFixed(1).padStart(5)}%`);
    }
    console.log(`  ${"TOTAL".padEnd(36)} ${round(total).toFixed(1).padStart(8)} ms   (${bd.chunks} chunks)\n`);

    // Repeats, interleaved: every concurrency level is measured once per pass rather than
    // REPEATS times back to back. A machine that drifts — thermal throttling, a background
    // process, Docker reclaiming memory — then biases every level equally instead of dumping the
    // drift onto whichever level happened to be running. Comparing two builds on one machine makes
    // this necessary rather than nice to have: the difference being measured here is smaller than
    // the spread between two runs of the same build.
    const passes: Awaited<ReturnType<typeof runAtConcurrency>>[][] = [];
    for (let r = 0; r < REPEATS; r++) {
      process.stdout.write(`  pass ${r + 1}/${REPEATS}... `);
      const pass: Awaited<ReturnType<typeof runAtConcurrency>>[] = [];
      for (const c of CONCURRENCIES) pass.push(await runAtConcurrency(c, owner.id));
      passes.push(pass);
      console.log(pass.map((x) => round(x.docsPerSec).toFixed(2)).join("  "));
    }

    console.log("\nthroughput vs worker concurrency (median of %d passes):", REPEATS);
    console.log(
      "  concurrency   docs/s   (min–max)      p50 (ms)   p95 (ms)   ES refresh/doc   refresh (ms)   speedup vs 1",
    );
    const results = CONCURRENCIES.map((c, i) => {
      const runs = passes.map((p) => p[i]);
      const pick = <T>(f: (r: (typeof runs)[number]) => number) => median(runs.map(f));
      return {
        concurrency: c,
        docsPerSec: pick((r) => r.docsPerSec),
        docsPerSecMin: Math.min(...runs.map((r) => r.docsPerSec)),
        docsPerSecMax: Math.max(...runs.map((r) => r.docsPerSec)),
        perDocP50Ms: pick((r) => r.perDocP50Ms),
        perDocP95Ms: pick((r) => r.perDocP95Ms),
        refreshes: pick((r) => r.refreshes),
        refreshMs: pick((r) => r.refreshMs),
        failed: runs.reduce((a, r) => a + r.failed, 0),
      };
    });
    for (const r of results) {
      const speedup = r.docsPerSec / results[0].docsPerSec;
      console.log(
        `  ${String(r.concurrency).padEnd(13)} ${round(r.docsPerSec).toFixed(2).padStart(6)}   ` +
          `(${round(r.docsPerSecMin).toFixed(2)}–${round(r.docsPerSecMax).toFixed(2)})`.padEnd(15) +
          `${round(r.perDocP50Ms).toFixed(0).padStart(8)}   ${round(r.perDocP95Ms).toFixed(0).padStart(8)}   ` +
          `${(r.refreshes / NUM_DOCS).toFixed(2).padStart(14)}   ${String(round(r.refreshMs)).padStart(12)}   ` +
          `${speedup.toFixed(2)}x${r.failed ? `   (${r.failed} FAILED)` : ""}`,
      );
    }

    // A benchmark on a shared desktop competes with whatever else the machine is doing, and a run
    // that lost the CPU halfway through still prints a plausible-looking median. The passes are
    // the check: repeats of the same configuration should agree closely, so when they do not, the
    // spread is measuring the environment rather than the code. Observed here — a run whose passes
    // ranged 3.15 to 8.49 docs/s at one concurrency level, while an editor woke up and took most
    // of four cores. Say so loudly instead of publishing the median.
    const worst = Math.max(...results.map((r) => r.docsPerSecMax / Math.max(r.docsPerSecMin, 1e-9)));
    if (worst > SPREAD_LIMIT) {
      console.log(
        `\n  ⚠ UNSTABLE: passes disagree by up to ${worst.toFixed(2)}× (limit ${SPREAD_LIMIT}×).\n` +
          `    Treat these numbers as contaminated by other load on the machine, not as a result.`,
      );
    }

    const best = results.reduce((a, b) => (b.docsPerSec > a.docsPerSec ? b : a));
    console.log(
      `\n  saturates at concurrency ${best.concurrency} (${round(best.docsPerSec)} docs/s). ` +
        `Runner reports ${(await import("node:os")).cpus().length} logical CPUs.`,
    );
    console.log(
      `  Embedding is in-process ONNX and CPU-bound, so concurrency past the core count contends\n` +
        `  for the same cores rather than adding throughput.`,
    );
  } finally {
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => {});
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
