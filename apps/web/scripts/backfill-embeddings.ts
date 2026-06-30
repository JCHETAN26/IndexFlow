/**
 * Backfill embeddings for chunks that were indexed before Step 2 (embedding IS NULL).
 * Run: pnpm --filter @indexflow/web embed:backfill
 */
import { prisma } from "../lib/prisma";
import { embed, toVectorLiteral } from "../lib/embed";

const BATCH = 32;

async function main() {
  const rows = await prisma.$queryRaw<{ id: string; content: string }[]>`
    SELECT id::text AS id, content
    FROM document_chunks
    WHERE embedding IS NULL
    ORDER BY "createdAt"
  `;

  if (rows.length === 0) {
    console.log("No chunks need embedding. ✓");
    return;
  }

  console.log(`Embedding ${rows.length} chunk(s)…`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vectors = await embed(batch.map((r) => r.content));
    for (let j = 0; j < batch.length; j++) {
      await prisma.$executeRaw`
        UPDATE document_chunks
        SET embedding = ${toVectorLiteral(vectors[j])}::vector
        WHERE id = ${batch[j].id}::uuid
      `;
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("Done. ✓");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
