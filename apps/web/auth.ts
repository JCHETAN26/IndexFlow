import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import { GUEST_ENABLED, getOrCreateDemoUser } from "@/lib/demo";

/**
 * Full Auth.js (NextAuth v5) server instance — identity foundation (Stage A).
 *
 * Uses the edge-safe base config plus the Prisma adapter. Session strategy is JWT so the
 * middleware can authorize on the edge without a DB call; the adapter still persists
 * users and the `accounts` row (incl. OAuth access/refresh tokens), which Stage C reuses
 * to call the Google Drive API on the user's behalf.
 *
 * The guest provider lives HERE rather than in auth.config.ts on purpose: it touches Prisma, and
 * auth.config.ts must stay edge-safe for the middleware. The middleware only needs the
 * `authorized` callback, so it does not matter that it cannot see this provider.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    ...authConfig.providers,
    // Lets someone try the public demo without a Google account. Every guest shares one
    // pre-seeded identity and it takes NO user input — there is no password to verify and
    // nothing an attacker can supply. Registered only when GUEST_ENABLED is set; otherwise
    // authorize() refuses unconditionally, so a normal deployment hands out no guest sessions.
    Credentials({
      id: "guest",
      name: "Guest",
      credentials: {},
      async authorize() {
        if (!GUEST_ENABLED) return null;
        const user = await getOrCreateDemoUser();
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
