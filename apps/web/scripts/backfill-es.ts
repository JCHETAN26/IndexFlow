/**
 * Backfill the Elasticsearch keyword index from Postgres (source of truth). Use after the
 * Step 6c ES swap to index documents that were ingested before ES existed, or to rebuild
 * the index from scratch. Idempotent — chunk id keys the ES document, so re-runs upsert.
 * Run: pnpm --filter @indexflow/web es:backfill
 */
import { prisma } from "../lib/prisma";
import { ensureChunkIndex, indexChunks, type EsChunk } from "../lib/es";

const BATCH = 200;

async function main() {
  const rows = await prisma.$queryRaw<
    { id: string; documentId: string; chunkIndex: number; content: string; title: string; fileType: string }[]
  >`
    SELECT dc.id::text AS id, dc."documentId"::text AS "documentId", dc."chunkIndex" AS "chunkIndex",
           dc.content AS content, d.title AS title, d."fileType" AS "fileType"
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    ORDER BY dc."createdAt"
  `;

  if (rows.length === 0) {
    console.log("No chunks to index. ✓");
    return;
  }

  await ensureChunkIndex();
  console.log(`Indexing ${rows.length} chunk(s) into Elasticsearch…`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch: EsChunk[] = rows.slice(i, i + BATCH).map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
      title: r.title,
      fileType: r.fileType,
      content: r.content,
    }));
    await indexChunks(batch, undefined, i + BATCH >= rows.length ? "wait_for" : false);
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
