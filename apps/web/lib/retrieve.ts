import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { embedOne, toVectorLiteral } from "@/lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "@/lib/hybrid";
import { keywordSearch } from "@/lib/es";
import type { Viewer } from "@/lib/acl";

/**
 * Shared retrieval used by both the search route (app/api/search) and the RAG
 * answer path (lib/rag). Keeping the keyword + semantic candidate fetchers and the
 * hybrid blend in one place means search results and the chunks fed to the LLM come
 * from the exact same ranking — `blendHybrid` / `DEFAULT_HYBRID_WEIGHT` (lib/hybrid)
 * stay the single source of truth for the blend.
 *
 * Both legs are permission-aware: every entry point requires a `viewer` so a caller
 * can't retrieve chunks the viewer can't see. Keyword filters index-side in
 * Elasticsearch (a `terms` filter on the chunk's denormalised ACL); semantic filters
 * with the SQL predicate below. The two encode the same rule (see lib/acl).
 */

export const CANDIDATE_LIMIT = 30;

/**
 * SQL predicate (over `documents d`) that is true iff the document is visible to the
 * viewer: public, owned by them, or granted to them directly or via a group. When
 * `userId` is null (anonymous) every clause but `is_public` is false, so they see only
 * public documents. Mirrors the ES `terms` filter on the same principals.
 */
function visibleToViewer(viewer: Viewer): Prisma.Sql {
  const uid = viewer.userId;
  return Prisma.sql`(
    d.is_public
    OR (${uid}::uuid IS NOT NULL AND d.owner_id = ${uid}::uuid)
    OR EXISTS (SELECT 1 FROM document_grants g WHERE g.document_id = d.id AND g.user_id = ${uid}::uuid)
    OR EXISTS (
      SELECT 1 FROM document_grants g
      JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = ${uid}::uuid
      WHERE g.document_id = d.id
    )
  )`;
}

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
  viewer: Viewer,
  limit: number = CANDIDATE_LIMIT,
): Promise<Candidate[]> {
  const hits = await keywordSearch(q, fileType, limit, undefined, viewer.principals);
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
  viewer: Viewer,
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
      AND ${visibleToViewer(viewer)}
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
  k: number,
  viewer: Viewer,
  fileType: string | null = null,
): Promise<RetrievedContext[]> {
  const [keyword, semantic] = await Promise.all([
    fetchKeyword(query, fileType, viewer),
    fetchSemantic(query, fileType, viewer),
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
