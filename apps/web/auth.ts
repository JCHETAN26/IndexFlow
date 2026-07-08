import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

/**
 * Full Auth.js (NextAuth v5) server instance — identity foundation (Stage A).
 *
 * Uses the edge-safe base config plus the Prisma adapter. Session strategy is JWT so the
 * middleware can authorize on the edge without a DB call; the adapter still persists
 * users and the `accounts` row (incl. OAuth access/refresh tokens), which Stage C reuses
 * to call the Google Drive API on the user's behalf.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
});
