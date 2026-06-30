-- Functional GIN index for Postgres full-text search over chunk content.
-- (Cannot be expressed in schema.prisma; managed as a raw migration.)
CREATE INDEX IF NOT EXISTS "document_chunks_content_fts_idx"
  ON "document_chunks"
  USING GIN (to_tsvector('english', "content"));
