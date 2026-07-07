import { prisma } from "./prisma";
import { getObject } from "./storage";
import { chunkText } from "./chunk";
import { embed, toVectorLiteral } from "./embed";

/**
 * Index a document end to end: download the original from object storage, extract text,
 * chunk, embed, and write chunks into Postgres. Idempotent — re-running replaces the
 * document's existing chunks. Called by the BullMQ worker (Step 6b).
 */
export async function ingestDocument(documentId: string): Promise<number> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { storageKey: true, fileType: true },
  });
  if (!doc?.storageKey) {
    throw new Error(`Document ${documentId} has no stored file to ingest.`);
  }

  const { body } = await getObject(doc.storageKey);
  // Step 6b handles .md/.txt (utf8). PDF extraction arrives in Step 7.
  const text = body.toString("utf8");
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`Document ${documentId} produced no chunks.`);
  }

  const vectors = await embed(chunks.map((c) => c.content));

  await prisma.$transaction(async (tx) => {
    // Idempotent re-index: clear any prior chunks first.
    await tx.$executeRaw`DELETE FROM document_chunks WHERE "documentId" = ${documentId}::uuid`;
    for (let i = 0; i < chunks.length; i++) {
      await tx.$executeRaw`
        INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
        VALUES (
          gen_random_uuid(),
          ${documentId}::uuid,
          ${chunks[i].index},
          ${chunks[i].content},
          ${chunks[i].tokenCount},
          ${toVectorLiteral(vectors[i])}::vector,
          now()
        )
      `;
    }
    await tx.document.update({
      where: { id: documentId },
      data: { status: "INDEXED", indexedAt: new Date() },
    });
  });

  return chunks.length;
}
