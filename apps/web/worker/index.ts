/**
 * BullMQ ingestion worker. Run: pnpm --filter @indexflow/web worker
 *
 * Consumes the "ingestion" queue: marks the job/document RUNNING, indexes the document
 * (download → chunk → embed → store), then marks it COMPLETED/INDEXED. Failures (after
 * retries) mark the job/document FAILED with the error message.
 */
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { ingestDocument } from "../lib/ingest";
import { INGESTION_QUEUE, connection, type IngestionJobData } from "../lib/queue";
import { drainOutbox, reconcile } from "../lib/outbox";

const worker = new Worker<IngestionJobData>(
  INGESTION_QUEUE,
  async (job) => {
    const { documentId, jobId } = job.data;
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.document.update({ where: { id: documentId }, data: { status: "INDEXING" } });

    const chunkCount = await ingestDocument(documentId);

    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    console.log(`[worker] indexed ${documentId} (${chunkCount} chunks)`);
  },
  // Configurable so the ingestion benchmark can measure throughput against worker count, and so
  // a deployment can match concurrency to its core count. Embedding is CPU-bound and in-process,
  // so raising this past the core count buys nothing — see bench/ingest-bench.ts.
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("failed", async (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
  if (!job) return;
  // Only mark terminal state once retries are exhausted.
  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const { documentId, jobId } = job.data;
  await prisma.ingestionJob
    .update({ where: { id: jobId }, data: { status: "FAILED", error: err.message, completedAt: new Date() } })
    .catch(() => {});
  await prisma.document.update({ where: { id: documentId }, data: { status: "FAILED" } }).catch(() => {});
});

/**
 * Outbox drainer. The inline projection in lib/outbox projectNow() covers the happy path; this
 * is what makes the guarantee durable when it does not — a transient Elasticsearch outage, or a
 * process that died between committing Postgres and projecting.
 */
const DRAIN_INTERVAL_MS = Number(process.env.OUTBOX_DRAIN_INTERVAL_MS ?? 5_000);
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 300_000);

const drainTimer = setInterval(() => {
  drainOutbox().then(
    ({ processed, failed }) => {
      if (processed || failed) console.log(`[outbox] drained ${processed} ok, ${failed} failed`);
    },
    (e) => console.error("[outbox] drain error:", e instanceof Error ? e.message : e),
  );
}, DRAIN_INTERVAL_MS);

/**
 * Periodic reconciliation. The outbox guarantees an update is owed; it cannot guarantee one ever
 * landed, and nothing stops Elasticsearch being changed out from under us. This sweep compares
 * both stores and queues repairs for anything that has drifted.
 */
const reconcileTimer = setInterval(() => {
  reconcile().then(
    ({ checked, repaired }) => {
      if (repaired.length) {
        console.warn(`[reconcile] ${repaired.length}/${checked} document(s) drifted; repair queued`);
      }
    },
    (e) => console.error("[reconcile] error:", e instanceof Error ? e.message : e),
  );
}, RECONCILE_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} — shutting down`);
  clearInterval(drainTimer);
  clearInterval(reconcileTimer);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log("[worker] listening on the ingestion queue…");
console.log(
  `[worker] outbox drain every ${DRAIN_INTERVAL_MS}ms, reconcile every ${RECONCILE_INTERVAL_MS}ms`,
);
