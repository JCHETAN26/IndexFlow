import { prisma } from "@/lib/prisma";
import { embedOne, toVectorLiteral } from "@/lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "@/lib/hybrid";
import { keywordSearch } from "@/lib/es";

/**
 * Shared retrieval used by both the search route (app/api/search) and the RAG
 * answer path (lib/rag). Keeping the keyword + semantic candidate fetchers and the
 * hybrid blend in one place means search results and the chunks fed to the LLM come
 * from the exact same ranking — `blendHybrid` / `DEFAULT_HYBRID_WEIGHT` (lib/hybrid)
 * stay the single source of truth for the blend.
 */

export const CANDIDATE_LIMIT = 30;

export interface Candidate {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string; // keyword: ES highlight w/ sentinels; semantic: raw content prefix
  score: number; // keyword: BM25; semantic: cosine similarity
}

// Keyword search runs on Elasticsearch (BM25 + highlighting). The sentinel-delimited
// snippet is HTML-escaped then re-marked by the caller (XSS-safe).
export async function fetchKeyword(
  q: string,
  fileType: string | null,
  limit: number = CANDIDATE_LIMIT,
): Promise<Candidate[]> {
  const hits = await keywordSearch(q, fileType, limit);
  return hits.map((h) => ({
    chunkId: h.chunkId,
    documentId: h.documentId,
    title: h.title,
    fileType: h.fileType,
    snippet: h.snippet,
    score: h.score,
  }));
}

export async function fetchSemantic(
  q: string,
  fileType: string | null,
  limit: number = CANDIDATE_LIMIT,
): Promise<Candidate[]> {
  const vec = toVectorLiteral(await embedOne(q));
  return prisma.$queryRaw<Candidate[]>`
    SELECT
      dc.id::text                          AS "chunkId",
      dc."documentId"::text                AS "documentId",
      d.title                              AS title,
      d."fileType"                         AS "fileType",
      left(dc.content, 320)                AS snippet,
      1 - (dc.embedding <=> ${vec}::vector) AS score
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    WHERE dc.embedding IS NOT NULL
      AND (${fileType}::text IS NULL OR d."fileType" = ${fileType})
    ORDER BY dc.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `;
}

export const toScored = (c: Candidate[]): Scored[] =>
  c.map((x) => ({ id: x.chunkId, score: x.score }));

/**
 * A full-content chunk chosen for grounding an LLM answer. Unlike search results
 * (which carry a 160/320-char highlighted snippet), the generator needs the whole
 * chunk, so `content` is fetched fresh from Postgres.
 */
export interface RetrievedContext {
  marker: number; // 1-based citation index the model cites as [n]
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  content: string;
}

/**
 * Top-k hybrid retrieval for RAG. Runs the same keyword + semantic + blend as search,
 * then hydrates the winning chunk ids with their full content from Postgres, preserving
 * blended rank order.
 */
export async function retrieveContexts(
  query: string,
  k = 6,
  fileType: string | null = null,
): Promise<RetrievedContext[]> {
  const [keyword, semantic] = await Promise.all([
    fetchKeyword(query, fileType),
    fetchSemantic(query, fileType),
  ]);
  const blended = blendHybrid(toScored(keyword), toScored(semantic), DEFAULT_HYBRID_WEIGHT);
  const topIds = blended.slice(0, k).map((b) => b.id);
  if (topIds.length === 0) return [];

  const rows = await prisma.$queryRaw<
    { chunkId: string; documentId: string; title: string; fileType: string; content: string }[]
  >`
    SELECT dc.id::text           AS "chunkId",
           dc."documentId"::text AS "documentId",
           d.title               AS title,
           d."fileType"          AS "fileType",
           dc.content            AS content
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    WHERE dc.id::text = ANY(${topIds})
  `;
  const byId = new Map(rows.map((r) => [r.chunkId, r]));

  return topIds
    .map((id, i) => {
      const r = byId.get(id);
      return r ? { marker: i + 1, ...r } : null;
    })
    .filter((c): c is RetrievedContext => c !== null);
}
