"use client";

import { useState } from "react";

type Strategy = "keyword" | "semantic" | "hybrid";
const STRATEGIES: Strategy[] = ["keyword", "semantic", "hybrid"];

interface StrategyMetrics {
  recall: { 1: number; 3: number; 5: number };
  mrr: number;
}
interface KindMetrics {
  r1: number;
  mrr: number;
}
interface GateRow {
  name: string;
  value: number;
  floor: number;
  pass: boolean;
}
interface EvalReport {
  numQueries: number;
  numDocs: number;
  hybridWeight: number;
  tookMs: number;
  strategies: Record<Strategy, StrategyMetrics>;
  byKind: Record<"exact" | "paraphrase", Record<Strategy, KindMetrics>>;
  sweep: { weight: number; mrr: number }[];
  gate: GateRow[];
  passed: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const f2 = (n: number) => n.toFixed(2);

export default function EvalPage() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/eval");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Eval failed (${res.status})`);
      setReport(json as EvalReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eval failed");
    } finally {
      setLoading(false);
    }
  };

  const bestMrr = report ? Math.max(...report.sweep.map((s) => s.mrr)) : 1;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Retrieval evaluation</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Recall@k and MRR for keyword vs semantic vs hybrid, measured on a labeled query
        set. Seeded in a rolled-back transaction — it never touches indexed data.
      </p>

      <button
        onClick={run}
        disabled={loading}
        className="mt-5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Running evaluation…" : report ? "Re-run evaluation" : "Run evaluation"}
      </button>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {report && (
        <div className="mt-8 space-y-10">
          <p className="text-xs text-neutral-500">
            {report.numQueries} queries · {report.numDocs} docs · best hybrid weight{" "}
            <span className="font-medium text-neutral-700">{f2(report.hybridWeight)}</span>{" "}
            (keyword) · {report.tookMs} ms
          </p>

          {/* Overall metrics */}
          <section>
            <h2 className="text-sm font-medium text-neutral-500">Overall</h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="py-2 font-medium">Strategy</th>
                  <th className="py-2 text-right font-medium">R@1</th>
                  <th className="py-2 text-right font-medium">R@3</th>
                  <th className="py-2 text-right font-medium">R@5</th>
                  <th className="py-2 text-right font-medium">MRR</th>
                </tr>
              </thead>
              <tbody>
                {STRATEGIES.map((s) => {
                  const m = report.strategies[s];
                  const isHybrid = s === "hybrid";
                  return (
                    <tr
                      key={s}
                      className={`border-b border-neutral-100 ${isHybrid ? "font-medium" : ""}`}
                    >
                      <td className="py-2 capitalize">
                        {s}
                        {isHybrid && (
                          <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] uppercase text-blue-600">
                            blend
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{pct(m.recall[1])}</td>
                      <td className="py-2 text-right tabular-nums">{pct(m.recall[3])}</td>
                      <td className="py-2 text-right tabular-nums">{pct(m.recall[5])}</td>
                      <td className="py-2 text-right tabular-nums">{f2(m.mrr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* By query kind */}
          <section>
            <h2 className="text-sm font-medium text-neutral-500">
              By query kind <span className="text-neutral-400">(R@1 / MRR)</span>
            </h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400">
                  <th className="py-2 font-medium">Kind</th>
                  {STRATEGIES.map((s) => (
                    <th key={s} className="py-2 text-right font-medium capitalize">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["exact", "paraphrase"] as const).map((kind) => (
                  <tr key={kind} className="border-b border-neutral-100">
                    <td className="py-2 capitalize">{kind}</td>
                    {STRATEGIES.map((s) => (
                      <td key={s} className="py-2 text-right tabular-nums">
                        {pct(report.byKind[kind][s].r1)} / {f2(report.byKind[kind][s].mrr)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-neutral-400">
              Keyword wins exact terms it matches but is brittle; semantic wins
              paraphrases; hybrid keeps both strengths.
            </p>
          </section>

          {/* Weight sweep */}
          <section>
            <h2 className="text-sm font-medium text-neutral-500">
              Hybrid weight sweep <span className="text-neutral-400">(keyword weight → MRR)</span>
            </h2>
            <div className="mt-3 space-y-1">
              {report.sweep.map((s) => {
                const chosen = s.weight === report.hybridWeight;
                return (
                  <div key={s.weight} className="flex items-center gap-3 text-xs">
                    <span className="w-8 tabular-nums text-neutral-400">{f2(s.weight)}</span>
                    <div className="h-4 flex-1 rounded bg-neutral-100">
                      <div
                        className={`h-4 rounded ${chosen ? "bg-neutral-900" : "bg-neutral-300"}`}
                        style={{ width: `${(s.mrr / bestMrr) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right tabular-nums text-neutral-500">
                      {f2(s.mrr)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              0.0 = semantic only · 1.0 = keyword only · highlighted bar = chosen weight.
            </p>
          </section>

          {/* Quality gate */}
          <section>
            <h2 className="text-sm font-medium text-neutral-500">
              Quality gate{" "}
              <span className={report.passed ? "text-green-600" : "text-red-600"}>
                {report.passed ? "passed" : "failed"}
              </span>
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {report.gate.map((row) => (
                <li key={row.name} className="flex items-center justify-between border-b border-neutral-100 py-1.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${row.pass ? "bg-green-500" : "bg-red-500"}`}
                    />
                    {row.name}
                  </span>
                  <span className="tabular-nums text-neutral-500">
                    {pct(row.value)} <span className="text-neutral-300">/ floor {pct(row.floor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
