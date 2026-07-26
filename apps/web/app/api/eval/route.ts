import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runEvaluation } from "@/eval/harness";
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
export const maxDuration = 60;

const SLOT = "eval";

/**
 * Runs the retrieval evaluation on demand (seeds a corpus in a rolled-back transaction) and
 * returns the report for the /eval page.
 *
 * Deliberately open to unauthenticated callers — the live evaluation is the thing this project is
 * meant to show, and it discloses nothing: it seeds and rolls back its own fixture corpus and
 * never touches real documents. But it embeds a whole corpus per call, so it is rate limited per
 * caller AND capped to one run at a time globally.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const key = callerKey(req, session?.user?.id ?? null);

  const rl = checkRateLimit(`eval:${key}`, LIMITS.evalRetrieval);
  if (!rl.ok) {
    return tooManyRequests(
      rl,
      "The evaluation is expensive to run. Please wait before starting another.",
    );
  }

  // One evaluation at a time, regardless of how many distinct callers ask.
  if (!tryAcquire(SLOT)) {
    return NextResponse.json(
      { error: "An evaluation is already running. Try again in a moment.", retryAfterSeconds: 30 },
      { status: 429, headers: { "Retry-After": "30", ...rateLimitHeaders(rl) } },
    );
  }

  try {
    const started = performance.now();
    const report = await runEvaluation();
    const tookMs = Math.round(performance.now() - started);
    return NextResponse.json({ ...report, tookMs }, { headers: rateLimitHeaders(rl) });
  } catch (e) {
    console.error("eval failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Evaluation failed" },
      { status: 500 },
    );
  } finally {
    release(SLOT);
  }
}
