import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { embedOne, toVectorLiteral } from "@/lib/embed";

export const runtime = "nodejs";

type SearchMode = "keyword" | "semantic";

interface RawRow {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string;
  score: number;
}

// Sentinel tokens for ts_headline so we can HTML-escape the snippet ourselves and
// then re-introduce <mark> safely (avoids XSS from raw chunk content).
const HL_START = "@@HL_START@@";
const HL_END = "@@HL_END@@";
const HEADLINE_OPTS = `StartSel=${HL_START}, StopSel=${HL_END}, MaxFragments=2, MinWords=8, MaxWords=28, FragmentDelimiter= … `;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHighlighted(raw: string): string {
  return escapeHtml(raw)
    .split(HL_START)
    .join("<mark>")
    .split(HL_END)
    .join("</mark>");
}

async function keywordSearch(q: string, fileType: string | null): Promise<RawRow[]> {
  return prisma.$queryRaw<RawRow[]>`
    SELECT
      dc.id::text                                                   AS "chunkId",
      dc."documentId"::text                                         AS "documentId",
      d.title                                                       AS title,
      d."fileType"                                                  AS "fileType",
      ts_headline('english', dc.content, plainto_tsquery('english', ${q}), ${HEADLINE_OPTS}) AS snippet,
      ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', ${q})) AS score
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', ${q})
      AND (${fileType}::text IS NULL OR d."fileType" = ${fileType})
    ORDER BY score DESC
    LIMIT 20
  `;
}

async function semanticSearch(q: string, fileType: string | null): Promise<RawRow[]> {
  const vec = toVectorLiteral(await embedOne(q));
  // Cosine similarity = 1 - cosine distance (<=>). Embeddings are unit vectors.
  return prisma.$queryRaw<RawRow[]>`
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
    LIMIT 20
  `;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const fileType = req.nextUrl.searchParams.get("fileType")?.trim() || null;
  const mode: SearchMode =
    req.nextUrl.searchParams.get("mode") === "semantic" ? "semantic" : "keyword";

  if (!q) {
    return NextResponse.json({ query: "", mode, latencyMs: 0, results: [] });
  }

  const started = performance.now();
  const rows = mode === "semantic"
    ? await semanticSearch(q, fileType)
    : await keywordSearch(q, fileType);
  const latencyMs = Math.round(performance.now() - started);

  const results = rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    title: r.title,
    fileType: r.fileType,
    snippet:
      mode === "keyword" ? renderHighlighted(r.snippet) : escapeHtml(r.snippet),
    // ts_rank is unbounded; cosine similarity is already 0..1.
    score: Number(r.score.toFixed(3)),
    source: mode,
  }));

  // For keyword mode, normalize the unbounded ts_rank to 0..1 for display parity.
  if (mode === "keyword" && results.length > 0) {
    const max = results.reduce((m, r) => Math.max(m, r.score), 0) || 1;
    for (const r of results) r.score = Number((r.score / max).toFixed(3));
  }

  return NextResponse.json({ query: q, mode, latencyMs, results });
}
