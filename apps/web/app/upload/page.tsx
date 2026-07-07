"use client";

import { useCallback, useRef, useState } from "react";

interface UploadItem {
  jobId: string;
  fileName: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  chunkCount: number;
  error?: string | null;
}

const LABEL: Record<UploadItem["status"], string> = {
  QUEUED: "Queued",
  RUNNING: "Indexing…",
  COMPLETED: "Indexed",
  FAILED: "Failed",
};

const COLOR: Record<UploadItem["status"], string> = {
  QUEUED: "text-neutral-500",
  RUNNING: "text-blue-600",
  COMPLETED: "text-green-600",
  FAILED: "text-red-600",
};

export default function UploadPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const poll = useCallback((jobId: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const j = await res.json();
        setItems((prev) =>
          prev.map((it) =>
            it.jobId === jobId
              ? { ...it, status: j.status, chunkCount: j.chunkCount, error: j.error }
              : it,
          ),
        );
        if (j.status !== "COMPLETED" && j.status !== "FAILED") {
          setTimeout(tick, 1200);
        }
      } catch {
        setTimeout(tick, 2000);
      }
    };
    setTimeout(tick, 800);
  }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setItems((prev) => [
        { jobId: json.jobId, fileName: json.document.fileName, status: "QUEUED", chunkCount: 0 },
        ...prev,
      ]);
      poll(json.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Upload a file</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Supported: <code>.md</code>, <code>.txt</code>. Files are stored, then indexed
        asynchronously by the ingestion worker.
      </p>

      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center transition-colors hover:border-neutral-400">
        <input
          ref={inputRef}
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <span className="text-sm font-medium">
          {busy ? "Uploading…" : "Click to choose a file"}
        </span>
        <span className="mt-1 text-xs text-neutral-400">.md or .txt, up to 5 MB</span>
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {items.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-neutral-500">This session</h2>
          <ul className="mt-2 space-y-2">
            {items.map((it) => (
              <li
                key={it.jobId}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 text-sm"
              >
                <span className="truncate font-medium">{it.fileName}</span>
                <span className="shrink-0">
                  <span className={COLOR[it.status]}>{LABEL[it.status]}</span>
                  {it.status === "COMPLETED" && (
                    <span className="ml-2 text-xs text-neutral-400">
                      {it.chunkCount} chunk{it.chunkCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {it.status === "FAILED" && it.error && (
                    <span className="ml-2 text-xs text-red-400">{it.error}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
