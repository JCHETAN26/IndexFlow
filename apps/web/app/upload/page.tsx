"use client";

import { useRef, useState } from "react";

interface UploadResult {
  document: { id: string; title: string; fileName: string; fileType: string };
  chunkCount: number;
}

export default function UploadPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<UploadResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setRecent((prev) => [json as UploadResult, ...prev]);
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
        Supported: <code>.md</code>, <code>.txt</code>. Files are chunked and indexed
        immediately.
      </p>

      <label
        className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center transition-colors hover:border-neutral-400"
      >
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
          {busy ? "Indexing…" : "Click to choose a file"}
        </span>
        <span className="mt-1 text-xs text-neutral-400">.md or .txt, up to 5 MB</span>
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {recent.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-neutral-500">Indexed this session</h2>
          <ul className="mt-2 space-y-2">
            {recent.map((r) => (
              <li
                key={r.document.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 text-sm"
              >
                <span className="truncate font-medium">{r.document.fileName}</span>
                <span className="shrink-0 text-xs text-neutral-400">
                  {r.chunkCount} chunk{r.chunkCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
