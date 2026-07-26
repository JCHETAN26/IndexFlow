/**
 * Compare Postgres against the Elasticsearch projection and repair any drift.
 *
 * The outbox guarantees an update is *owed*; it cannot guarantee one ever landed. Events can
 * exhaust their retries, and nothing stops Elasticsearch being modified out from under the app.
 * This is the sweep that answers "would we even know if the two stores disagreed?".
 *
 * Reports drift, queues repairs, then drains them. Exits non-zero if anything is still failing.
 *
 * Run: pnpm --filter @indexflow/web reconcile
 */
import { prisma } from "../lib/prisma";
import { drainOutbox, reconcile } from "../lib/outbox";

async function main() {
  const { checked, repaired } = await reconcile(5000);
  console.log(`reconcile: checked ${checked} document(s), ${repaired.length} drifted`);

  if (repaired.length === 0) {
    console.log("Postgres and Elasticsearch agree. ✓");
    return;
  }
  for (const id of repaired) console.log(`  repair queued: ${id}`);

  const result = await drainOutbox(5000);
  console.log(`repaired: ${result.processed} projected, ${result.failed} failed`);
  if (result.failed > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
