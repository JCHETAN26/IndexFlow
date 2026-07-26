import { NextRequest, NextResponse } from "next/server";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT } from "@/lib/hybrid";
import { HL_START, HL_END } from "@/lib/es";
import { fetchKeyword, fetchSemantic, toScored, type Candidate } from "@/lib/retrieve";
import { auth } from "@/auth";
import { viewerFrom, type Viewer } from "@/lib/acl";
import { LIMITS, callerKey, checkRateLimit, rateLimitHeaders, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";

type SearchMode = "keyword" | "semantic" | "hybrid";
const MODES: SearchMode[] = ["keyword", "semantic", "hybrid"];

const RESULT_LIMIT = 20;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderHighlighted(raw: string): string {
  return escapeHtml(raw).split(HL_START).join("<mark>").split(HL_END).join("</mark>");
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
    score: Number((c.score / max).toFixed(3)), // BM25 is unbounded → normalize for display
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

async function hybridSearch(q: string, fileType: string | null, viewer: Viewer): Promise<Hit[]> {
  const [keyword, semantic] = await Promise.all([
    fetchKeyword(q, fileType, viewer),
    fetchSemantic(q, fileType, viewer),
  ]);

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

  // Permission-aware: retrieval only ever returns chunks this viewer can see. An
  // unauthenticated request resolves to a public-only viewer.
  const session = await auth();

  // Every query embeds the text, so this is not free. Limit per caller.
  const rl = checkRateLimit(`search:${callerKey(req, session?.user?.id ?? null)}`, LIMITS.search);
  if (!rl.ok) return tooManyRequests(rl, "Too many searches. Please slow down.");

  const viewer = await viewerFrom(session?.user?.id ?? null);

  const started = performance.now();
  let results: Hit[];
  if (mode === "hybrid") {
    results = await hybridSearch(q, fileType, viewer);
  } else if (mode === "semantic") {
    results = formatSemantic(await fetchSemantic(q, fileType, viewer));
  } else {
    results = formatKeyword(await fetchKeyword(q, fileType, viewer));
  }
  const latencyMs = Math.round(performance.now() - started);

  return NextResponse.json({ query: q, mode, latencyMs, results }, { headers: rateLimitHeaders(rl) });
}
