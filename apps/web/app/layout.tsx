import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "IndexFlow",
  description: "Hybrid workspace search — keyword + semantic.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              IndexFlow
            </Link>
            {session?.user ? (
              <nav className="flex items-center gap-5 text-sm text-neutral-600">
                <Link href="/" className="hover:text-neutral-900">
                  Search
                </Link>
                <Link href="/documents" className="hover:text-neutral-900">
                  Documents
                </Link>
                <Link href="/upload" className="hover:text-neutral-900">
                  Upload
                </Link>
                <Link href="/jobs" className="hover:text-neutral-900">
                  Jobs
                </Link>
                <Link href="/groups" className="hover:text-neutral-900">
                  Groups
                </Link>
                <Link href="/eval" className="hover:text-neutral-900">
                  Eval
                </Link>
                <span className="hidden text-neutral-300 sm:inline">·</span>
                <span className="hidden max-w-[16ch] truncate text-neutral-400 sm:inline">
                  {session.user.email}
                </span>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/signin" });
                  }}
                >
                  <button type="submit" className="hover:text-neutral-900">
                    Sign out
                  </button>
                </form>
              </nav>
            ) : null}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
