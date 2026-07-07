import { Queue, type ConnectionOptions } from "bullmq";

export const INGESTION_QUEUE = "ingestion";
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

export interface IngestionJobData {
  documentId: string;
  jobId: string; // ingestion_jobs.id
}

// Pass connection *options* (not an ioredis instance) so BullMQ owns the connection
// and there's only one copy of ioredis in play. maxRetriesPerRequest must be null.
const url = new URL(REDIS_URL);
export const connection: ConnectionOptions = {
  host: url.hostname,
  port: Number(url.port) || 6379,
  ...(url.username ? { username: url.username } : {}),
  ...(url.password ? { password: url.password } : {}),
  maxRetriesPerRequest: null,
};

// Lazy singleton so importing this module (e.g. during `next build`) never connects.
let queue: Queue | undefined;
export function getIngestionQueue(): Queue {
  queue ??= new Queue(INGESTION_QUEUE, { connection });
  return queue;
}
