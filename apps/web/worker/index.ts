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
  { connection, concurrency: 2 },
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

console.log("[worker] listening on the ingestion queue…");
