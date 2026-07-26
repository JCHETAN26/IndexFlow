/**
 * Deployment smoke tests.
 *
 * Run against a built/staged/prod app:
 *   APP_URL=https://example.com pnpm --filter @indexflow/web smoke:deploy
 *
 * This is intentionally unauthenticated: it checks the public/read-only surfaces that should be
 * safe in every environment. Authenticated workflow coverage stays in Playwright.
 */

const BASE = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

async function check(path: string, opts: { expectStatus?: number; timeoutMs?: number } = {}) {
  const expectStatus = opts.expectStatus ?? 200;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
    const ms = Math.round(performance.now() - started);
    if (res.status !== expectStatus) {
      throw new Error(`${path} returned ${res.status}, expected ${expectStatus}`);
    }
    console.log(`PASS ${path} ${res.status} ${ms}ms`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Smoke target: ${BASE}`);
  await check("/api/health");
  await check("/api/search?q=deployment&mode=hybrid");
  await check("/api/documents");
  await check("/api/jobs", { expectStatus: 401 });
  console.log("Deployment smoke passed.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
