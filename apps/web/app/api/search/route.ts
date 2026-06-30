import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { embedOne, toVectorLiteral } from "@/lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "@/lib/hybrid";

export const runtime = "nodejs";

type SearchMode = "keyword" | "semantic" | "hybrid";
const MODES: SearchMode[] = ["keyword", "semantic", "hybrid"];

interface Candidate {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string; // keyword: ts_headline w/ sentinels; semantic: raw content
  score: number; // keyword: ts_rank; semantic: cosine similarity
}

const CANDIDATE_LIMIT = 30;
const RESULT_LIMIT = 20;

// Sentinel tokens for ts_headline so we can HTML-escape the snippet ourselves and
// then re-introduce <mark> safely (avoids XSS from raw chunk content).
const HL_START = "@@HL_START@@";
const HL_END = "@@HL_END@@";
const HEADLINE_OPTS = `StartSel=${HL_START}, StopSel=${HL_END}, MaxFragments=2, MinWords=8, MaxWords=28, FragmentDelimiter= … `;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderHighlighted(raw: string): string {
  return escapeHtml(raw).split(HL_START).join("<mark>").split(HL_END).join("</mark>");
}

function fetchKeyword(q: string, fileType: string | null): Promise<Candidate[]> {
  return prisma.$queryRaw<Candidate[]>`
    SELECT
      dc.id::text           AS "chunkId",
      dc."documentId"::text AS "documentId",
      d.title               AS title,
      d."fileType"          AS "fileType",
      ts_headline('english', dc.content, plainto_tsquery('english', ${q}), ${HEADLINE_OPTS}) AS snippet,
      ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', ${q})) AS score
    FROM document_chunks dc
    JOIN documents d ON d.id = dc."documentId"
    WHERE to_tsvector('english', dc.content) @@ plainto_tsquery('english', ${q})
      AND (${fileType}::text IS NULL OR d."fileType" = ${fileType})
    ORDER BY score DESC
    LIMIT ${CANDIDATE_LIMIT}
  `;
}

async function fetchSemantic(q: string, fileType: string | null): Promise<Candidate[]> {
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
    LIMIT ${CANDIDATE_LIMIT}
  `;
}

interface Hit {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string;
  score: number;
  source: SearchMode;
}

function formatKeyword(cands: Candidate[]): Hit[] {
  const max = cands.reduce((m, c) => Math.max(m, c.score), 0) || 1;
  return cands.slice(0, RESULT_LIMIT).map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    title: c.title,
    fileType: c.fileType,
    snippet: renderHighlighted(c.snippet),
    score: Number((c.score / max).toFixed(3)), // ts_rank is unbounded → normalize for display
    source: "keyword" as const,
  }));
}

function formatSemantic(cands: Candidate[]): Hit[] {
  return cands.slice(0, RESULT_LIMIT).map((c) => ({
    chunkId: c.chunkId,
    documentId: c.documentId,
    title: c.title,
    fileType: c.fileType,
    snippet: escapeHtml(c.snippet),
    score: Number(c.score.toFixed(3)), // cosine is already 0..1
    source: "semantic" as const,
  }));
}

async function hybridSearch(q: string, fileType: string | null): Promise<Hit[]> {
  const [keyword, semantic] = await Promise.all([
    fetchKeyword(q, fileType),
    fetchSemantic(q, fileType),
  ]);

  const toScored = (c: Candidate[]): Scored[] =>
    c.map((x) => ({ id: x.chunkId, score: x.score }));
  const blended = blendHybrid(toScored(keyword), toScored(semantic), DEFAULT_HYBRID_WEIGHT);

  // Prefer the keyword candidate (it carries a highlighted snippet); fall back to semantic.
  const kwById = new Map(keyword.map((c) => [c.chunkId, c]));
  const smById = new Map(semantic.map((c) => [c.chunkId, c]));

  const hits: Hit[] = [];
  for (const { id, score } of blended.slice(0, RESULT_LIMIT)) {
    const kw = kwById.get(id);
    const sm = smById.get(id);
    const meta = kw ?? sm!;
    hits.push({
      chunkId: id,
      documentId: meta.documentId,
      title: meta.title,
      fileType: meta.fileType,
      snippet: kw ? renderHighlighted(kw.snippet) : escapeHtml(sm!.snippet),
      score: Number(score.toFixed(3)),
      source: "hybrid",
    });
  }
  return hits;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const fileType = req.nextUrl.searchParams.get("fileType")?.trim() || null;
  const requested = req.nextUrl.searchParams.get("mode") as SearchMode | null;
  const mode: SearchMode = requested && MODES.includes(requested) ? requested : "keyword";

  if (!q) {
    return NextResponse.json({ query: "", mode, latencyMs: 0, results: [] });
  }

  const started = performance.now();
  let results: Hit[];
  if (mode === "hybrid") {
    results = await hybridSearch(q, fileType);
  } else if (mode === "semantic") {
    results = formatSemantic(await fetchSemantic(q, fileType));
  } else {
    results = formatKeyword(await fetchKeyword(q, fileType));
  }
  const latencyMs = Math.round(performance.now() - started);

  return NextResponse.json({ query: q, mode, latencyMs, results });
}
