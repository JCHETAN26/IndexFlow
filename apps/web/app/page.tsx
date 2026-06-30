"use client";

import { useCallback, useRef, useState } from "react";

interface Result {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string;
  score: number;
  source: "keyword" | "semantic" | "hybrid";
}

interface SearchResponse {
  query: string;
  latencyMs: number;
  results: Result[];
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const onChange = (value: string) => {
    setQ(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(value), 200);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Search your workspace
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Keyword search over indexed files. Semantic + hybrid coming in the next steps.
      </p>

      <div className="mt-6">
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Try: mobile editor latency"
          className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
      </div>

      <div className="mt-3 h-5 text-xs text-neutral-500">
        {loading && "Searching…"}
        {!loading && data && (
          <span>
            {data.results.length} result{data.results.length === 1 ? "" : "s"} ·{" "}
            {data.latencyMs} ms
          </span>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>

      <ul className="mt-4 space-y-3">
        {data?.results.map((r) => (
          <li
            key={r.chunkId}
            className="rounded-lg border border-neutral-200 p-4 transition-colors hover:border-neutral-300"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="truncate font-medium">{r.title}</h2>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                  {r.fileType}
                </span>
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-600">
                  {r.source}
                </span>
                <span className="text-xs tabular-nums text-neutral-400">
                  {r.score.toFixed(2)}
                </span>
              </div>
            </div>
            <p
              className="mt-2 text-sm leading-relaxed text-neutral-600"
              dangerouslySetInnerHTML={{ __html: r.snippet }}
            />
          </li>
        ))}
      </ul>

      {!loading && data && data.results.length === 0 && (
        <p className="mt-8 text-center text-sm text-neutral-400">
          No results for “{data.query}”.
        </p>
      )}
    </div>
  );
}
