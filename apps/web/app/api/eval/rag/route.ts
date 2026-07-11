import { NextResponse } from "next/server";
import { runRagEvaluation } from "@/eval/rag-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // gen + LLM-judge over ~20 questions; local/on-demand, not CI

// Runs the generation (RAG) evaluation on demand for the /eval page. Makes real Claude
// API calls, so it requires ANTHROPIC_API_KEY and is intentionally not part of CI.
export async function GET() {
  try {
    const started = performance.now();
    const report = await runRagEvaluation();
    const tookMs = Math.round(performance.now() - started);
    return NextResponse.json({ ...report, tookMs });
  } catch (e) {
    console.error("rag eval failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation evaluation failed" },
      { status: 500 },
    );
  }
}
