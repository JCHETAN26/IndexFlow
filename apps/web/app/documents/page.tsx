"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Doc {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  status: string;
  uploadedAt: string;
  indexedAt: string | null;
  chunkCount: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = await res.json();
      setDocs(json.documents as Doc[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (doc: Doc) => {
    if (!confirm(`Delete "${doc.fileName}" and its ${doc.chunkCount} chunk(s)?`)) return;
    setDeleting(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status})`);
      setDocs((prev) => (prev ? prev.filter((d) => d.id !== doc.id) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <Link
          href="/upload"
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Upload
        </Link>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Everything indexed and searchable. {docs ? `${docs.length} document${docs.length === 1 ? "" : "s"}.` : ""}
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {docs === null && <p className="mt-8 text-sm text-neutral-400">Loading…</p>}

      {docs && docs.length === 0 && (
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center">
          <p className="text-sm text-neutral-500">No documents yet.</p>
          <Link href="/upload" className="mt-2 inline-block text-sm font-medium underline">
            Upload your first file
          </Link>
        </div>
      )}

      {docs && docs.length > 0 && (
        <ul className="mt-6 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{d.title}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-400">
                  {d.fileName} · {formatDate(d.uploadedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  {d.fileType}
                </span>
                <span className="text-xs tabular-nums text-neutral-400">
                  {d.chunkCount} chunk{d.chunkCount === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => remove(d)}
                  disabled={deleting === d.id}
                  className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  {deleting === d.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
