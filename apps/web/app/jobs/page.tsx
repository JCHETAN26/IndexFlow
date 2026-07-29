"use client";

import { useCallback, useEffect, useState } from "react";

interface Job {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  document: {
    id: string;
    title: string;
    fileName: string;
    fileType: string;
    chunkCount: number;
  } | null;
}

const COLOR: Record<Job["status"], string> = {
  QUEUED: "bg-neutral-100 text-neutral-500",
  RUNNING: "bg-blue-50 text-blue-600",
  COMPLETED: "bg-green-50 text-green-600",
  FAILED: "bg-red-50 text-red-600",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setJobs((await res.json()).jobs as Job[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setJobs([]);
    }
  }, []);

  // Auto-refresh while anything is in flight.
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const retry = async (job: Job) => {
    setRetrying(job.id);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Retry failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Ingestion jobs</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Async indexing runs on a BullMQ queue. This view auto-refreshes.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {jobs === null && <p className="mt-8 text-sm text-neutral-400">Loading…</p>}

      {jobs && jobs.length === 0 && (
        <p className="mt-10 text-center text-sm text-neutral-400">
          No jobs yet. Upload a file to kick one off.
        </p>
      )}

      {jobs && jobs.length > 0 && (
        <ul className="mt-6 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {j.document?.title ?? "(deleted document)"}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-400">
                  {j.document?.fileName} · queued {fmt(j.createdAt)}
                  {j.error && <span className="text-red-400"> · {j.error}</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {j.status === "COMPLETED" && j.document && (
                  <span className="text-xs tabular-nums text-neutral-400">
                    {j.document.chunkCount} chunk{j.document.chunkCount === 1 ? "" : "s"}
                  </span>
                )}
                <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${COLOR[j.status]}`}>
                  {j.status}
                </span>
                {j.status === "FAILED" && j.document && (
                  <button
                    onClick={() => retry(j)}
                    disabled={retrying === j.id}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50"
                  >
                    {retrying === j.id ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
