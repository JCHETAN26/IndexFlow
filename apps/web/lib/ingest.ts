import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { getObject } from "./storage";
import { extractText } from "./extract";
import { chunkText } from "./chunk";
import { embed, toVectorLiteral } from "./embed";
import { enqueueProjection, projectNow } from "./outbox";

/**
 * Index a document end to end: download the original from object storage, extract text, chunk,
 * embed, and write chunks into Postgres — the source of truth. Elasticsearch is NOT written here.
 * Instead the same transaction records an outbox event, and the projector (lib/outbox.ts) brings
 * the keyword index in line by re-reading current state.
 *
 * That indirection is deliberate. Writing ES directly from here meant using an ACL snapshot taken
 * before several seconds of embedding, which silently discarded any permission change made in the
 * meantime. Idempotent — re-running replaces the document's chunks in both stores.
 * Called by the BullMQ worker.
 */
export async function ingestDocument(
  documentId: string,
  /**
   * `project: false` commits the Postgres side and the outbox row but skips the inline
   * projection, leaving the document exactly as a crash between commit and projection would —
   * INDEXING, with the update durably owed. Used by eval/consistency-check.ts to exercise that
   * recovery path; production callers always project.
   */
  opts: { project?: boolean } = {},
): Promise<number> {
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
    // New content → new version. The document does NOT become INDEXED here: it is only ready
    // once the keyword leg actually has it, which the projector decides. Marking it ready at
    // this point was how a failed mirror produced a document that claimed to be indexed but
    // could not be found by keyword search.
    await tx.document.update({
      where: { id: documentId },
      data: { contentVersion: { increment: 1 }, status: "INDEXING" },
    });
    // Committed with the chunks, so the projection can never be silently skipped.
    await enqueueProjection(tx, documentId, "ingest:content");
  });

  // Fast path: project immediately so the document is searchable when the worker reports done.
  // The ACL is re-read inside projectDocument, AFTER the slow embedding above — which is what
  // stops a revoke landing mid-ingest from being overwritten by a stale snapshot.
  if (opts.project !== false) await projectNow(documentId);

  return chunks.length;
}
