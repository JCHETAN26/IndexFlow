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

interface Citation {
  marker: number;
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
}

interface AnswerState {
  text: string;
  citations: Citation[];
  done: boolean;
  refused: boolean;
  error: string | null;
  outputTokens: number | null;
  latencyMs: number | null;
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

// Split answer text into plain spans and clickable [n] citation chips.
function renderAnswer(text: string, citations: Citation[], onCite: (marker: number) => void) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    const marker = Number(m[1]);
    const cite = citations.find((c) => c.marker === marker);
    return (
      <button
        key={i}
        onClick={() => onCite(marker)}
        title={cite ? `Source: ${cite.title}` : undefined}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-blue-100 px-1 align-super text-[10px] font-semibold text-blue-700 hover:bg-blue-200"
      >
        {marker}
      </button>
    );
  });
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(-1);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [answering, setAnswering] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const answerAbort = useRef<AbortController | null>(null);

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

  // Generate a grounded answer for the current query. Explicit (button / Enter), not
  // on-type — each call hits the LLM. Streams NDJSON frames from /api/answer.
  const runAnswer = useCallback(async (query: string) => {
    if (!query.trim()) return;
    answerAbort.current?.abort();
    const ctrl = new AbortController();
    answerAbort.current = ctrl;
    const started = Date.now();
    setAnswering(true);
    setAnswer({ text: "", citations: [], done: false, refused: false, error: null, outputTokens: null, latencyMs: null });
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Answer failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const frame = JSON.parse(line) as
            | { type: "contexts"; contexts: Citation[] }
            | { type: "delta"; text: string }
            | { type: "done"; refused: boolean; usage: { output_tokens: number } | null }
            | { type: "error"; error: string };
          setAnswer((prev) => {
            const cur = prev ?? { text: "", citations: [], done: false, refused: false, error: null, outputTokens: null, latencyMs: null };
            if (frame.type === "contexts") return { ...cur, citations: frame.contexts };
            if (frame.type === "delta") return { ...cur, text: cur.text + frame.text };
            if (frame.type === "done")
              return { ...cur, done: true, refused: frame.refused, outputTokens: frame.usage?.output_tokens ?? null, latencyMs: Date.now() - started };
            return { ...cur, error: frame.error, done: true };
          });
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setAnswer((prev) => ({
        text: prev?.text ?? "",
        citations: prev?.citations ?? [],
        done: true,
        refused: false,
        error: e instanceof Error ? e.message : "Answer failed",
        outputTokens: null,
        latencyMs: null,
      }));
    } finally {
      if (answerAbort.current === ctrl) setAnswering(false);
    }
  }, []);

  const onChange = (value: string) => {
    setQ(value);
    setAnswer(null); // stale once the query changes
    answerAbort.current?.abort();
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(value, mode), 200);
  };

  const onModeChange = (next: Mode) => {
    setMode(next);
    if (q.trim()) runSearch(q, next);
  };

  // Jump to the result card backing a citation (if it's in the current result set).
  const onCite = (marker: number) => {
    const cite = answer?.citations.find((c) => c.marker === marker);
    if (!cite || !data) return;
    const idx = data.results.findIndex((r) => r.chunkId === cite.chunkId);
    if (idx >= 0) setSelected(idx);
  };

  // Keep the keyboard-selected result scrolled into view.
  useEffect(() => {
    if (selected < 0 || !listRef.current) return;
    const el = listRef.current.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runAnswer(q);
      return;
    }
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
        Keyword (exact terms), semantic (meaning), and a measured hybrid blend — plus a grounded answer.
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

      <div className="mt-3 flex items-center justify-between gap-2">
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
        <button
          onClick={() => runAnswer(q)}
          disabled={!q.trim() || answering}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {answering ? "Answering…" : "✨ Answer"}
        </button>
      </div>

      {/* Grounded answer panel */}
      {answer && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-blue-700">
            Grounded answer
            {!answer.done && <span className="text-blue-400">· streaming…</span>}
          </div>
          {answer.error ? (
            <p className="mt-2 text-sm text-red-600">{answer.error}</p>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
              {renderAnswer(answer.text, answer.citations, onCite)}
              {!answer.done && <span className="ml-0.5 animate-pulse">▍</span>}
            </p>
          )}
          {answer.done && !answer.error && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-blue-200/60 pt-2 text-[11px] text-neutral-500">
              <span>
                {answer.refused ? "refused (not in the documents)" : `grounded in ${answer.citations.length} source${answer.citations.length === 1 ? "" : "s"}`}
              </span>
              {answer.latencyMs != null && <span>· {(answer.latencyMs / 1000).toFixed(1)}s</span>}
              {answer.outputTokens != null && <span>· {answer.outputTokens} tokens</span>}
              {!answer.refused && answer.citations.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {answer.citations.map((c) => (
                    <button
                      key={c.marker}
                      onClick={() => onCite(c.marker)}
                      className="rounded bg-white px-1.5 py-0.5 text-[10px] text-neutral-600 ring-1 ring-neutral-200 hover:ring-neutral-400"
                    >
                      [{c.marker}] {c.title}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="h-5 text-xs text-neutral-500">
          {loading && "Searching…"}
          {!loading && data && (
            <span>
              {data.results.length} result{data.results.length === 1 ? "" : "s"} · {data.latencyMs} ms
            </span>
          )}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        {data && data.results.length > 0 && (
          <span className="hidden text-xs text-neutral-400 sm:inline">↑↓ to navigate · ⏎ to answer</span>
        )}
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
