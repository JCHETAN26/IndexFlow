import { expect, test, type Page } from "@playwright/test";
import { PRIVATE_TERM, PRIVATE_TITLE, PUBLIC_TERM, PUBLIC_TITLE } from "./fixtures";

/**
 * The principal workflow: sign in as a guest and confirm that what the browser can reach matches
 * what the permission model says it should.
 *
 * The value here is not that it repeats the unit and integration assertions — it is that it
 * exercises the assembled application. Middleware, session cookies, the API routes and the UI all
 * have to agree, and only a browser can show that they do.
 */

async function signInAsGuest(page: Page) {
  await page.goto("/signin");
  await page.getByRole("button", { name: /continue as guest/i }).click();
  // The server action replies 303 and Next performs a soft (RSC) navigation, so waiting on a URL
  // glob is unreliable. Waiting for the search heading is both robust and the thing we mean:
  // the guest is signed in and looking at the app.
  await expect(page.getByRole("heading", { name: /search your workspace/i })).toBeVisible({
    timeout: 30_000,
  });
}

async function search(page: Page, term: string, mode: "Keyword" | "Semantic" | "Hybrid" = "Keyword") {
  await page.getByRole("button", { name: mode, exact: true }).click();
  const input = page.getByRole("textbox").first();
  await input.fill("");
  await input.fill(term);
  // The results line ("N results · M ms") is the signal that a search actually completed;
  // asserting on it avoids racing the debounce.
  await expect(page.getByText(/\d+ results? · \d+ ms/)).toBeVisible({ timeout: 30_000 });
}

test.describe("unauthenticated visitor", () => {
  test("is redirected to sign-in and offered guest access", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/signin**");
    await expect(page.getByRole("button", { name: /continue as guest/i })).toBeVisible();
  });
});

test.describe("guest principal", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsGuest(page);
  });

  test("finds a public document", async ({ page }) => {
    await search(page, PUBLIC_TERM);
    await expect(page.getByRole("heading", { name: PUBLIC_TITLE })).toBeVisible();
  });

  test("NEVER sees another user's private document, on any search mode", async ({ page }) => {
    // The core security claim of the whole project, asserted through the UI.
    for (const mode of ["Keyword", "Semantic", "Hybrid"] as const) {
      await search(page, PRIVATE_TERM, mode);

      // Scoped to result items on purpose. Asserting on the whole page would match the
      // empty-state message, which echoes the query back ("No results for <term>") — that is the
      // search box working, not a leak.
      const results = page.getByRole("listitem");
      await expect(results.filter({ hasText: PRIVATE_TITLE })).toHaveCount(0);
      await expect(results.filter({ hasText: PRIVATE_TERM })).toHaveCount(0);
    }
  });

  test("the private document's content is unreachable even by direct API call", async ({ page }) => {
    // Belt and braces: the UI hiding something is not the same as the server refusing it.
    const res = await page.request.get(`/api/search?q=${PRIVATE_TERM}&mode=hybrid`);
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain(PRIVATE_TITLE);
  });

  test("does not see the private document in the documents list", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByText(PRIVATE_TITLE)).toHaveCount(0);
  });

  test("does not see the private document's title on the jobs page", async ({ page }) => {
    // This surface leaked every document's title to anyone, with no authentication at all.
    await page.goto("/jobs");
    await expect(page.getByText(PRIVATE_TITLE)).toHaveCount(0);
  });

  test("can run the live retrieval evaluation", async ({ page }) => {
    // The per-test timeout caps every assertion inside it, so the 180s budget below was
    // unreachable under the config's 60s default: the test was killed at 60s while the eval was
    // still seeding and embedding, and the assertion never got the room its comment promised.
    // Passing at all depended on the runner finishing under 60s, which is why this failed
    // intermittently in CI and always passed on a fast machine.
    test.setTimeout(240_000);
    await page.goto("/eval");
    await page.getByRole("button", { name: "Run evaluation", exact: true }).click();
    // The harness seeds, embeds and scores a corpus; give it room.
    await expect(page.getByRole("button", { name: "Re-run evaluation" })).toBeVisible({
      timeout: 180_000,
    });
  });
});
