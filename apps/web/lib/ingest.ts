import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { getObject } from "./storage";
import { extractText } from "./extract";
import { chunkText } from "./chunk";
import { embed, toVectorLiteral } from "./embed";
import { ensureChunkIndex, indexChunks, deleteDocumentChunks, type EsChunk } from "./es";
import { aclTokens } from "./acl";

/**
 * Index a document end to end: download the original from object storage, extract text,
 * chunk, embed, write chunks into Postgres (source of truth + embeddings) and mirror them
 * into Elasticsearch (keyword search + highlighting). Idempotent — re-running replaces the
 * document's existing chunks in both stores. Called by the BullMQ worker (Step 6b/6c).
 */
export async function ingestDocument(documentId: string): Promise<number> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      storageKey: true,
      fileType: true,
      title: true,
      isPublic: true,
      ownerId: true,
      grants: { select: { userId: true, groupId: true } },
    },
  });
  if (!doc?.storageKey) {
    throw new Error(`Document ${documentId} has no stored file to ingest.`);
  }

  const { body } = await getObject(doc.storageKey);
  const text = await extractText(body, doc.fileType);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`Document ${documentId} produced no chunks (empty or unreadable file).`);
  }

  const vectors = await embed(chunks.map((c) => c.content));

  // Pre-generate chunk ids so the same id keys the row in Postgres and the doc in ES —
  // hybrid blending correlates keyword + semantic hits by chunk id.
  const ids = chunks.map(() => randomUUID());

  await prisma.$transaction(async (tx) => {
    // Idempotent re-index: clear any prior chunks first.
    await tx.$executeRaw`DELETE FROM document_chunks WHERE "documentId" = ${documentId}::uuid`;
    for (let i = 0; i < chunks.length; i++) {
      await tx.$executeRaw`
        INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
        VALUES (
          ${ids[i]}::uuid,
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

  // Mirror into Elasticsearch after Postgres commits. Refresh so the chunks are
  // immediately searchable (worker throughput isn't latency-critical).
  await ensureChunkIndex();
  await deleteDocumentChunks(documentId, undefined, true);
  const acl = aclTokens(doc); // denormalise the document's ACL onto every chunk
  const esChunks: EsChunk[] = chunks.map((c, i) => ({
    chunkId: ids[i],
    documentId,
    chunkIndex: c.index,
    title: doc.title,
    fileType: doc.fileType,
    content: c.content,
    acl,
  }));
  await indexChunks(esChunks, undefined, "wait_for");

  return chunks.length;
}
