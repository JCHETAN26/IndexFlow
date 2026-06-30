-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "embedding" vector(384);

-- HNSW index for fast approximate nearest-neighbour search (cosine distance).
CREATE INDEX "document_chunks_embedding_hnsw_idx"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops);
