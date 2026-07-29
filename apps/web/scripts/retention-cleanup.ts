/**
 * Retention cleanup for operational tables.
 *
 * Keeps source documents and chunks. Deletes old terminal ingestion jobs and completed outbox
 * rows so dashboards stay useful and local/staging databases do not grow forever.
 *
 *   RETENTION_DAYS=30 pnpm --filter @indexflow/web retention:cleanup
 *   DRY_RUN=1 pnpm --filter @indexflow/web retention:cleanup
 */
import { prisma } from "../lib/prisma";
import { JobStatus } from "@prisma/client";

const days = Number(process.env.RETENTION_DAYS ?? 30);
const dryRun = process.env.DRY_RUN === "1";
const cutoff = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

async function main() {
  const oldJobs = {
    status: { in: [JobStatus.COMPLETED, JobStatus.FAILED] },
    completedAt: { lt: cutoff },
  };
  const oldOutbox = {
    status: "DONE" as const,
    processedAt: { lt: cutoff },
  };

  const [jobCount, outboxCount] = await Promise.all([
    prisma.ingestionJob.count({ where: oldJobs }),
    prisma.outboxEvent.count({ where: oldOutbox }),
  ]);

  console.log(`Retention cutoff: ${cutoff.toISOString()} (${days} days)`);
  console.log(`Terminal ingestion jobs: ${jobCount}`);
  console.log(`Done outbox events: ${outboxCount}`);

  if (dryRun) {
    console.log("DRY_RUN=1, no rows deleted.");
    return;
  }

  const [jobs, outbox] = await prisma.$transaction([
    prisma.ingestionJob.deleteMany({ where: oldJobs }),
    prisma.outboxEvent.deleteMany({ where: oldOutbox }),
  ]);
  console.log(`Deleted ${jobs.count} ingestion job(s), ${outbox.count} outbox event(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
