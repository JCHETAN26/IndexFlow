import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "IndexFlow",
  description: "Hybrid workspace search — keyword + semantic.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-neutral-200">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              IndexFlow
            </Link>
            <nav className="flex gap-5 text-sm text-neutral-600">
              <Link href="/" className="hover:text-neutral-900">
                Search
              </Link>
              <Link href="/upload" className="hover:text-neutral-900">
                Upload
              </Link>
              <Link href="/eval" className="hover:text-neutral-900">
                Eval
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
