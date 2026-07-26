import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  callerKey,
  checkRateLimit,
  release,
  resetRateLimits,
  tryAcquire,
} from "@/lib/ratelimit";

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit and refuses beyond it", () => {
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [1, 2, 3, 4].map(() => checkRateLimit("k", rule));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  });

  it("counts each caller separately", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("a", rule).ok).toBe(true);
    expect(checkRateLimit("b", rule).ok).toBe(true); // b must not inherit a's usage
    expect(checkRateLimit("a", rule).ok).toBe(false);
  });

  it("reports remaining without going negative", () => {
    const rule = { limit: 2, windowMs: 60_000 };
    checkRateLimit("k", rule);
    checkRateLimit("k", rule);
    const over = checkRateLimit("k", rule);
    expect(over.remaining).toBe(0);
  });

  it("starts a fresh window once the old one expires", async () => {
    const rule = { limit: 1, windowMs: 40 };
    expect(checkRateLimit("k", rule).ok).toBe(true);
    expect(checkRateLimit("k", rule).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(checkRateLimit("k", rule).ok).toBe(true);
  });

  it("always suggests a retry delay of at least a second", () => {
    const r = checkRateLimit("k", { limit: 0, windowMs: 10 });
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});

describe("callerKey", () => {
  const req = (headers: Record<string, string> = {}) =>
    new NextRequest("http://localhost/api/search", { headers });

  it("prefers the user id, so people behind one NAT are not lumped together", () => {
    expect(callerKey(req({ "x-forwarded-for": "1.2.3.4" }), "user-1")).toBe("user:user-1");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    expect(callerKey(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), null)).toBe("ip:1.2.3.4");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(callerKey(req({ "x-real-ip": "5.6.7.8" }), null)).toBe("ip:5.6.7.8");
    expect(callerKey(req(), null)).toBe("ip:unknown");
  });
});

describe("concurrency guard", () => {
  it("admits up to max and refuses the rest until released", () => {
    expect(tryAcquire("slot", 1)).toBe(true);
    expect(tryAcquire("slot", 1)).toBe(false);
    release("slot");
    expect(tryAcquire("slot", 1)).toBe(true);
    release("slot");
  });

  it("does not underflow when released more often than acquired", () => {
    release("never-held");
    release("never-held");
    expect(tryAcquire("never-held", 1)).toBe(true);
    release("never-held");
  });
});
