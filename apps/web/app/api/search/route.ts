import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

interface KeywordRow {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string;
  score: number;
}

const HEADLINE_OPTS =
  "StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MinWords=8, MaxWords=28, FragmentDelimiter= … ";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const fileType = req.nextUrl.searchParams.get("fileType")?.trim() || null;

  if (!q) {
    return NextResponse.json({ query: "", latencyMs: 0, results: [] });
  }

  const started = performance.now();

  const rows = await prisma.$queryRaw<KeywordRow[]>`
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

  const latencyMs = Math.round(performance.now() - started);

  // Normalize ts_rank (small, unbounded) to a friendly 0..1 for display.
  const max = rows.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  const results = rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    title: r.title,
    fileType: r.fileType,
    snippet: r.snippet,
    score: Number((r.score / max).toFixed(3)),
    source: "keyword" as const,
  }));

  return NextResponse.json({ query: q, latencyMs, results });
}
