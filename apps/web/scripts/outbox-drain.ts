/**
 * Drain pending outbox events once, from the command line.
 *
 * The worker does this on a timer; this is the manual handle for when the worker was not running
 * (or was down during an Elasticsearch outage) and projections have piled up.
 *
 * Run: pnpm --filter @indexflow/web outbox:drain
 */
import { prisma } from "../lib/prisma";
import { drainOutbox } from "../lib/outbox";

async function main() {
  const pending = await prisma.outboxEvent.count({ where: { status: "PENDING" } });
  const failed = await prisma.outboxEvent.count({ where: { status: "FAILED" } });
  console.log(`outbox: ${pending} pending, ${failed} failed (exhausted retries)`);
  if (pending === 0) return;

  const result = await drainOutbox(1000);
  console.log(`drained: ${result.processed} projected, ${result.failed} failed`);
  if (result.failed > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
