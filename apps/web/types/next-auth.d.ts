import type { DefaultSession } from "next-auth";

// Surface the user id on the session (populated in the session callback in auth.ts).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
