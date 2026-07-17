import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe Auth.js config (no Prisma adapter, no Node APIs) shared by the middleware
 * and the full server instance in auth.ts. Keeping the adapter out of here is what lets
 * the middleware run on the edge. Env: AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET.
 */
export const authConfig = {
  trustHost: true,
  pages: { signIn: "/signin" },
  providers: [
    Google({
      // Stage A: identity only. Stage C re-consents to add the Drive scope.
      authorization: {
        params: { scope: "openid email profile", access_type: "offline", prompt: "consent" },
      },
    }),
  ],
  callbacks: {
    // Route protection for the middleware: everything requires login except /signin.
    authorized({ auth, request: { nextUrl } }) {
      if (nextUrl.pathname.startsWith("/signin")) return true;
      return !!auth?.user;
    },
    // JWT strategy: token.sub is the user id; expose it on the session.
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
