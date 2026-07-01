-- DropIndex
DROP INDEX "document_chunks_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "storageKey" TEXT;
