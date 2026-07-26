import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runRagEvaluation } from "@/eval/rag-harness";
import { DEMO_MODE } from "@/lib/demo";
import {
  LIMITS,
  callerKey,
  checkRateLimit,
  rateLimitHeaders,
  release,
  tooManyRequests,
  tryAcquire,
} from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // gen + LLM-judge over ~20 questions; local/on-demand, not CI

const SLOT = "eval-rag";

/**
 * Runs the generation (RAG) evaluation on demand for the /eval page.
 *
 * By far the most expensive endpoint in the app: it drives three local Ollama models over a
 * 32-question set and takes ~30 minutes on a laptop. So it is capped hard — one run per caller
 * per hour, one run at a time globally — and refused outright in the hosted demo, which has no
 * Ollama to run it on.
 */
export async function GET(req: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json(
      {
        error:
          "The generation evaluation is disabled in this public demo. It drives three local " +
          "Ollama models for roughly 30 minutes, which the demo host cannot run. Clone the repo " +
          "and run `pnpm --filter @indexflow/web eval:rag`, or see apps/web/eval/RESULTS.md for " +
          "the captured output of a real run.",
      },
      { status: 503 },
    );
  }

  const session = await auth();
  const key = callerKey(req, session?.user?.id ?? null);

  const rl = checkRateLimit(`eval-rag:${key}`, LIMITS.evalRag);
  if (!rl.ok) {
    return tooManyRequests(
      rl,
      "The generation evaluation takes ~30 minutes of local compute. Please wait before running it again.",
    );
  }

  if (!tryAcquire(SLOT)) {
    return NextResponse.json(
      {
        error: "A generation evaluation is already running. Only one can run at a time.",
        retryAfterSeconds: 120,
      },
      { status: 429, headers: { "Retry-After": "120", ...rateLimitHeaders(rl) } },
    );
  }

  try {
    const started = performance.now();
    const report = await runRagEvaluation();
    const tookMs = Math.round(performance.now() - started);
    return NextResponse.json({ ...report, tookMs }, { headers: rateLimitHeaders(rl) });
  } catch (e) {
    console.error("rag eval failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generation evaluation failed" },
      { status: 500 },
    );
  } finally {
    release(SLOT);
  }
}
