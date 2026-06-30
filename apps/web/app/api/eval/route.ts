import { NextResponse } from "next/server";
import { runEvaluation } from "@/eval/harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Runs the retrieval evaluation on demand (seeds a corpus in a rolled-back
// transaction) and returns the report for the /eval page.
export async function GET() {
  try {
    const started = performance.now();
    const report = await runEvaluation();
    const tookMs = Math.round(performance.now() - started);
    return NextResponse.json({ ...report, tookMs });
  } catch (e) {
    console.error("eval failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Evaluation failed" },
      { status: 500 },
    );
  }
}
