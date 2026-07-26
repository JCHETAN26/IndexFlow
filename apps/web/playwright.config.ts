import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the principal workflow: what a given identity can actually see and do
 * through the real UI.
 *
 * These exist because every layer below them is tested in isolation — the ACL helper, the
 * projector, the route handlers — and none of that proves the assembled application enforces
 * permissions in a browser. The `acl:dao` script checks HTTP status codes; this checks what a
 * person actually ends up looking at.
 *
 * Runs the app with ALLOW_GUEST=1 so a browser can obtain a session without Google OAuth, which
 * is the only way to drive a signed-in journey in CI at all.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
// Must be `localhost`, not 127.0.0.1. Auth.js derives its URLs from the request host, and the
// session cookie is scoped to whichever it sees; browsing 127.0.0.1 while the cookie is issued
// for localhost means the middleware never sees a session and bounces every page back to
// /signin — which looks exactly like broken authentication.
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  // Relative to this file. Playwright loads the config as CommonJS, so `import.meta.url` is not
  // available here.
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // The suite asserts on a fixture corpus shared by all specs; parallel workers would race on it.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // A production build, not `next dev`. The dev server compiles routes on demand and, under
    // load on a small machine, serves 500s from half-written build manifests
    // ("SyntaxError: Unexpected end of JSON input") — which reads as broken authentication when
    // it is really a dev-server race. `next start` is deterministic and closer to what deploys.
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 420_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ALLOW_GUEST: "1",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-not-a-real-secret",
    },
  },
});
