import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge middleware built from the adapter-free config. The `authorized` callback
// redirects unauthenticated users to /signin for every matched (page) route.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware;

// Protect pages; skip API routes, Next internals, and static files.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
