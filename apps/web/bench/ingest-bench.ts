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
import { ensureChunkIndex, deleteDocumentChunks } from "../lib/es";

const NUM_DOCS = Number(process.env.INGEST_DOCS ?? 40);
const CONCURRENCIES = (process.env.INGEST_CONCURRENCY ?? "1,2,4,8")
  .split(",")
  .map((s) => Number(s.trim()));
const QUEUE_NAME = "ingestion-bench";
const TAG = "[ingest-bench]";

const round = (n: number) => Math.round(n * 100) / 100;
const p50 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

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

async function runAtConcurrency(concurrency: number, ownerId: string) {
  const docs = await seed(NUM_DOCS, ownerId);
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
    if (++completed + failed >= NUM_DOCS) resolveAll();
  });
  worker.on("failed", (_j, err) => {
    failed++;
    console.error(`${TAG} job failed: ${err.message}`);
    if (completed + failed >= NUM_DOCS) resolveAll();
  });

  const start = performance.now();
  await queue.addBulk(
    docs.map((d) => ({ name: "ingest", data: { documentId: d.id, jobId: d.jobId } })),
  );
  await allDone;
  const wallMs = performance.now() - start;

  await worker.close();
  await queue.close();
  await cleanup(docs);

  return {
    concurrency,
    wallSeconds: wallMs / 1000,
    docsPerSec: NUM_DOCS / (wallMs / 1000),
    perDocP50Ms: p50(perDoc),
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
    console.log(`  path: MinIO download -> extract -> chunk -> embed -> Postgres txn -> outbox -> ES\n`);

    console.log("stage breakdown (single document, cold):");
    const bd = await stageBreakdown(owner.id);
    const total = Object.values(bd.stages).reduce((a, b) => a + b, 0);
    for (const [k, v] of Object.entries(bd.stages).sort((a, b) => b[1] - a[1])) {
      const share = (v / total) * 100;
      console.log(`  ${k.padEnd(36)} ${round(v).toFixed(1).padStart(8)} ms   ${share.toFixed(1).padStart(5)}%`);
    }
    console.log(`  ${"TOTAL".padEnd(36)} ${round(total).toFixed(1).padStart(8)} ms   (${bd.chunks} chunks)\n`);

    console.log("throughput vs worker concurrency:");
    console.log("  concurrency   docs/s    wall (s)   per-doc p50 (ms)   speedup vs 1");
    const results: Awaited<ReturnType<typeof runAtConcurrency>>[] = [];
    for (const c of CONCURRENCIES) {
      const r = await runAtConcurrency(c, owner.id);
      results.push(r);
      const speedup = r.docsPerSec / results[0].docsPerSec;
      console.log(
        `  ${String(r.concurrency).padEnd(13)} ${round(r.docsPerSec).toFixed(2).padStart(6)}   ` +
          `${round(r.wallSeconds).toFixed(1).padStart(8)}   ${round(r.perDocP50Ms).toFixed(0).padStart(16)}   ` +
          `${speedup.toFixed(2)}x${r.failed ? `   (${r.failed} FAILED)` : ""}`,
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
