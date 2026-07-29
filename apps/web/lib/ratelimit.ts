import { NextRequest, NextResponse } from "next/server";

/**
 * Per-caller rate limiting and global concurrency guards for the public demo.
 *
 * Why this exists: `/api/eval` and `/api/eval/rag` run a full evaluation on demand — seeding a
 * corpus, embedding it, and (for the RAG one) driving local LLMs for tens of minutes. On a public
 * URL with guest access, an unauthenticated visitor could start as many as they liked and flatten
 * the box. Search and answer are cheaper but still do real embedding work per call.
 *
 * SCOPE — read before trusting this:
 *   - State is IN-MEMORY, so limits are PER PROCESS and reset on restart or redeploy. That is
 *     sufficient for the single-container demo this is written for, and it deliberately avoids
 *     adding a Redis dependency to a deployment that otherwise does not need one. Behind multiple
 *     instances, the effective limit multiplies by the instance count.
 *   - It is NOT a defence against a distributed or determined attacker; IP keys are cheap to
 *     rotate. It stops accidental hammering and casual abuse. Anything stronger belongs at the
 *     edge (host WAF / CDN rate limiting), in front of the app.
 *   - The concurrency guard below is the part that actually protects the machine: it caps how
 *     many expensive evaluations can run at once regardless of who asks.
 */

interface Window {
  count: number;
  resetAt: number; // epoch ms
}

export interface RateLimitRule {
  /** Max requests allowed per window, per caller. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

const buckets = new Map<string, Window>();

// Bound memory: a flood of unique keys must not grow the map without limit. When we exceed the
// cap we drop already-expired entries first, and if that is not enough, the oldest ones.
const MAX_KEYS = 10_000;

function sweep(now: number) {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
  if (buckets.size <= MAX_KEYS) return;
  const overflow = buckets.size - MAX_KEYS;
  let dropped = 0;
  for (const k of buckets.keys()) {
    buckets.delete(k);
    if (++dropped >= overflow) break;
  }
}

/**
 * Fixed-window counter. Chosen over a sliding window because the failure mode we care about is
 * "someone is hammering an expensive endpoint", where a burst at a window boundary is harmless.
 */
export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) sweep(now);

  const existing = buckets.get(key);
  const win: Window =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };

  win.count += 1;
  buckets.set(key, win);

  const remaining = Math.max(0, rule.limit - win.count);
  return {
    ok: win.count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt: win.resetAt,
    retryAfterSec: Math.max(1, Math.ceil((win.resetAt - now) / 1000)),
  };
}

/** Test/maintenance hook — drops all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Identify the caller. A signed-in user is keyed by id so they are not punished for sharing an IP
 * (office NAT, mobile carrier); everyone else falls back to IP.
 *
 * NOTE on x-forwarded-for: the leftmost entry is the client as reported by the first proxy, and
 * it is trivially spoofable when the app is exposed directly. It is only meaningful when a trusted
 * proxy sits in front and overwrites it — which is the case on the managed hosts this demo targets.
 * Do not treat the resulting key as an identity.
 */
export function callerKey(req: NextRequest, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
  return `ip:${ip}`;
}

/** Standard rate-limit headers, set on allowed and rejected responses alike. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(Math.ceil((r.resetAt - Date.now()) / 1000)),
  };
}

/** The 429 to return when a caller is over their limit. */
export function tooManyRequests(r: RateLimitResult, message: string): NextResponse {
  return NextResponse.json(
    { error: message, retryAfterSeconds: r.retryAfterSec },
    {
      status: 429,
      headers: { ...rateLimitHeaders(r), "Retry-After": String(r.retryAfterSec) },
    },
  );
}

/**
 * Global concurrency guard — the real protection for expensive work.
 *
 * A rate limit still lets N different callers each start one evaluation simultaneously. This caps
 * the total in flight regardless of who asks, so the box cannot be driven into swap by a handful
 * of coordinated (or merely unlucky) requests.
 */
const inFlight = new Map<string, number>();

export function tryAcquire(slot: string, max = 1): boolean {
  const current = inFlight.get(slot) ?? 0;
  if (current >= max) return false;
  inFlight.set(slot, current + 1);
  return true;
}

export function release(slot: string): void {
  const current = inFlight.get(slot) ?? 0;
  if (current <= 1) inFlight.delete(slot);
  else inFlight.set(slot, current - 1);
}

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Per-surface limits, all overridable by env so a deployment can tighten them without a rebuild.
 * Defaults are generous enough that ordinary local development never notices them, and tight
 * enough that a public demo cannot be trivially exhausted.
 */
export const LIMITS = {
  /** Cheap-ish: one embedding per query. */
  search: { limit: envInt("RL_SEARCH_PER_MIN", 30), windowMs: 60_000 },
  /** Retrieval + (locally) generation. */
  answer: { limit: envInt("RL_ANSWER_PER_MIN", 10), windowMs: 60_000 },
  /** Writes: storage + a queued ingestion job. */
  upload: { limit: envInt("RL_UPLOAD_PER_HOUR", 20), windowMs: 3_600_000 },
  /** Expensive: seeds and embeds a whole corpus per call. */
  evalRetrieval: { limit: envInt("RL_EVAL_PER_10MIN", 3), windowMs: 600_000 },
  /** Very expensive: drives local LLMs, tens of minutes per call. */
  evalRag: { limit: envInt("RL_EVAL_RAG_PER_HOUR", 1), windowMs: 3_600_000 },
} satisfies Record<string, RateLimitRule>;
