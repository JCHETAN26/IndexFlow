"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  mode: Mode;
  latencyMs: number;
  results: Result[];
}

type Mode = "keyword" | "semantic" | "hybrid";

const MODES: { id: Mode; label: string }[] = [
  { id: "keyword", label: "Keyword" },
  { id: "semantic", label: "Semantic" },
  { id: "hybrid", label: "Hybrid" },
];

const PLACEHOLDER: Record<Mode, string> = {
  keyword: "Try: mobile editor latency",
  semantic: "Try: typing feels slow on phones",
  hybrid: "Try: ERR_QUOTA_4096 or storage limit",
};

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const runSearch = useCallback(async (query: string, searchMode: Mode) => {
    if (!query.trim()) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&mode=${searchMode}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      setData(await res.json());
      setSelected(-1);
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
    debounce.current = setTimeout(() => runSearch(value, mode), 200);
  };

  const onModeChange = (next: Mode) => {
    setMode(next);
    if (q.trim()) runSearch(q, next);
  };

  // Keep the keyboard-selected result scrolled into view.
  useEffect(() => {
    if (selected < 0 || !listRef.current) return;
    const el = listRef.current.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = data?.results.length ?? 0;
    if (n === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, n - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Escape") {
      setSelected(-1);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Search your workspace</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Keyword (exact terms), semantic (meaning), and a measured hybrid blend.
      </p>

      <div className="mt-6">
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={PLACEHOLDER[mode]}
          className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-neutral-200 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onModeChange(m.id)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                mode === m.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {data && data.results.length > 0 && (
          <span className="hidden text-xs text-neutral-400 sm:inline">
            ↑↓ to navigate
          </span>
        )}
      </div>

      <div className="mt-3 h-5 text-xs text-neutral-500">
        {loading && "Searching…"}
        {!loading && data && (
          <span>
            {data.results.length} result{data.results.length === 1 ? "" : "s"} · {data.latencyMs} ms
          </span>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>

      <ul ref={listRef} className="mt-4 space-y-3">
        {data?.results.map((r, i) => (
          <li
            key={r.chunkId}
            onMouseEnter={() => setSelected(i)}
            className={`rounded-lg border p-4 transition-colors ${
              selected === i
                ? "border-neutral-900 ring-2 ring-neutral-900/10"
                : "border-neutral-200 hover:border-neutral-300"
            }`}
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
                <span className="text-xs tabular-nums text-neutral-400">{r.score.toFixed(2)}</span>
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
        <div className="mt-10 rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center">
          <p className="text-sm text-neutral-500">No results for “{data.query}”.</p>
          {mode === "keyword" && (
            <p className="mt-1 text-xs text-neutral-400">
              Keyword needs exact terms — try Semantic or Hybrid for meaning.
            </p>
          )}
        </div>
      )}

      {!loading && !data && !error && (
        <p className="mt-10 text-center text-sm text-neutral-400">
          Type to search. Nothing indexed yet?{" "}
          <a href="/upload" className="underline">
            Upload a file
          </a>
          .
        </p>
      )}
    </div>
  );
}
