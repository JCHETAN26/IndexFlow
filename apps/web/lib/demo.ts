import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Demo-deployment support: the guest identity, the read-only switch, and the seed token.
 *
 * All three exist so the app can be shown publicly without a Google sign-in and without
 * handing anonymous visitors write access. Every escape hatch here is OFF unless its env var
 * is explicitly set, so a normal deployment behaves exactly as if this file did not exist.
 */

/** Stable identity every guest session shares. Owns the seeded public demo corpus. */
export const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL ?? "guest@indexflow.demo";
export const DEMO_USER_NAME = "Guest";

/**
 * Read-only mode for the public demo: mutations are refused and answer generation is off
 * (the hosted demo has no Ollama). Defence in depth on top of real authorization — it is a
 * second lock, never the only one.
 */
export const DEMO_MODE = process.env.DEMO_MODE === "1";

/**
 * Whether "Continue as guest" is offered at all. Off by default: a normal deployment should not
 * hand out sessions to anyone who asks. DEMO_MODE implies it, since a read-only public demo is
 * exactly the case where guest access is the point.
 */
export const GUEST_ENABLED = DEMO_MODE || process.env.ALLOW_GUEST === "1";

/** JSON body + 403 for a mutation attempted while DEMO_MODE is on. */
export const demoReadOnlyResponse = {
  error: "This is a read-only public demo. Uploading, deleting and sharing are disabled.",
} as const;

/** Find or create the shared guest user. Idempotent — safe to call on every guest sign-in. */
export async function getOrCreateDemoUser(): Promise<{ id: string; email: string; name: string }> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: {},
    create: { email: DEMO_USER_EMAIL, name: DEMO_USER_NAME },
    select: { id: true, email: true, name: true },
  });
  return { id: user.id, email: user.email ?? DEMO_USER_EMAIL, name: user.name ?? DEMO_USER_NAME };
}

/**
 * Seed-script authentication.
 *
 * `scripts/seed.ts` loads the demo corpus through the real HTTP upload route, but has no
 * browser session to sign in with. Rather than leaving upload open to anonymous callers (the
 * hole this replaces), it presents a shared secret. Disabled unless SEED_TOKEN is set to at
 * least 16 characters, and it grants exactly one capability: upload as the demo user.
 */
const SEED_TOKEN = process.env.SEED_TOKEN ?? "";
export const SEED_TOKEN_HEADER = "x-seed-token";

export function isValidSeedToken(presented: string | null): boolean {
  if (!presented || SEED_TOKEN.length < 16) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(SEED_TOKEN);
  // Compare length first: timingSafeEqual throws on a length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}
