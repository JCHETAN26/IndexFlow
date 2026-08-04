/**
 * The regression suite for the measuring instrument itself.
 *
 * `recallAt`, `mrr`, `precisionAt` and `ndcgAt` decide whether CI's quality gate passes, and they
 * are from-scratch implementations. These tests substitute rankers whose scores can be derived on
 * paper for the real retriever, so every assertion below is an exact hand-computed value rather
 * than a snapshot of whatever the code happened to produce.
 *
 * Expectations were derived and written into docs/eval/WORKLOG.md *before* this file existed. If
 * an assertion here fails, the metric is wrong until proven otherwise — do not adjust the number
 * to match the output.
 *
 * Derivations. The held-out split holds 34 queries — 29 with one relevant doc, 4 with two, and 1
 * with none — over N = 17 single-chunk documents. Since Phase 2 the unanswerable query is excluded
 * from every ranking metric rather than scored as a miss, so the denominator is j = 33, matching
 * trec_eval. Sums below run over judged queries only:
 *
 *   oracle MRR     = 1                               = 1.0
 *   oracle R@1     = (1/j)·Σ 1/tᵢ                     = 31/33    ← still not 1.0
 *   oracle R@3,R@5 = (1/j)·Σ min(k,tᵢ)/tᵢ             = 1.0
 *   oracle P@3     = (1/j)·Σ min(k,tᵢ)/k              = 37/99
 *   oracle nDCG@5  = 1                               = 1.0
 *   reversed MRR   = (1/j)·Σ 1/(N−tᵢ+1)               = 133/2244
 *   random E[R@k]  = k/N
 *   random E[MRR]  = (1/j)·Σ_r (1/r)·C(N−r,tᵢ−1)/C(N,tᵢ)
 *
 * R@1 and P@3 keep sub-1.0 ceilings after the exclusion, because label density binds them
 * independently: four queries have two relevant documents, and P@k divides by k.
 */
import { describe, expect, it } from "vitest";
import {
  ceilingFor,
  dedupDocs,
  mrr,
  ndcgAt,
  precisionAt,
  ranksForQuery,
  recallAt,
  type Labeled,
} from "@/eval/metrics";
import corpus from "@/eval/corpus.json";
import queries from "@/eval/queries.json";

const DOCS: string[] = corpus.map((d) => d.fileName);
const N = DOCS.length;
const TEST_ROWS: Labeled[] = queries
  .filter((q) => (q as { split?: string }).split !== "tune")
  .map((q) => ({ relevant: q.relevant }));

/** Exact expectations, as rationals evaluated at full double precision. */
const EXPECT = {
  oracle: { mrr: 1, r1: 31 / 33, r3: 1, r5: 1, p3: 37 / 99, ndcg5: 1 },
  reversed: { mrr: 133 / 2244 },
  random: { mrr: 196825243 / 916467552, r1: 1 / 17, r3: 3 / 17, r5: 5 / 17, p3: 37 / 561 },
} as const;

// ── synthetic rankers ─────────────────────────────────────────────────────
/** Every relevant document first, in label order, then everything else. */
const oracle = (row: Labeled): string[] => [
  ...row.relevant,
  ...DOCS.filter((d) => !row.relevant.includes(d)),
];

/** Every relevant document last — the floor. */
const reversed = (row: Labeled): string[] => [
  ...DOCS.filter((d) => !row.relevant.includes(d)),
  ...row.relevant,
];

/** Deterministic mulberry32, so a failing seed is reproducible. */
function shuffled(seed: number): string[] {
  let s = seed + 0x9e3779b9;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...DOCS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ranksOf = (rank: (row: Labeled) => string[], rows: Labeled[] = TEST_ROWS): number[][] =>
  rows.map((row) => ranksForQuery(rank(row), row.relevant));

// ── the label set these expectations were derived from ────────────────────
describe("label set assumptions", () => {
  it("matches the density the expectations were derived from", () => {
    expect(N).toBe(17);
    expect(TEST_ROWS.length).toBe(34);
    const byCount = TEST_ROWS.reduce<Record<number, number>>((acc, r) => {
      acc[r.relevant.length] = (acc[r.relevant.length] ?? 0) + 1;
      return acc;
    }, {});
    // 29 single-relevant, 4 double-relevant, 1 unanswerable. Change this and every exact
    // expectation in this file must be re-derived, which is the point of asserting it.
    expect(byCount).toEqual({ 0: 1, 1: 29, 2: 4 });
  });

  it("labels only documents that exist in the corpus", () => {
    const unknown = TEST_ROWS.flatMap((r) => r.relevant).filter((d) => !DOCS.includes(d));
    expect(unknown).toEqual([]);
  });
});

// ── oracle: the attainable ceiling ────────────────────────────────────────
describe("oracle ranker (relevant documents at rank 1)", () => {
  const ranks = ranksOf(oracle);

  it("scores MRR exactly 1.0 now the unanswerable query is excluded", () => {
    expect(mrr(ranks, TEST_ROWS)).toBeCloseTo(EXPECT.oracle.mrr, 12);
  });

  it("scores R@1 31/33, still not 1.0 — four queries have two relevant documents", () => {
    expect(recallAt(ranks, TEST_ROWS, 1)).toBeCloseTo(EXPECT.oracle.r1, 12);
    expect(recallAt(ranks, TEST_ROWS, 1)).toBeLessThan(1);
  });

  it("scores R@3 and R@5 at 1.0", () => {
    expect(recallAt(ranks, TEST_ROWS, 3)).toBeCloseTo(EXPECT.oracle.r3, 12);
    expect(recallAt(ranks, TEST_ROWS, 5)).toBeCloseTo(EXPECT.oracle.r5, 12);
  });

  it("scores P@3 at 37/99, still capped by dividing by k", () => {
    expect(precisionAt(ranks, TEST_ROWS, 3)).toBeCloseTo(EXPECT.oracle.p3, 12);
    expect(precisionAt(ranks, TEST_ROWS, 3)).toBeLessThan(0.4);
  });

  it("scores nDCG@5 at 1.0 — a perfect ranking has DCG equal to IDCG", () => {
    expect(ndcgAt(ranks, TEST_ROWS, 5)).toBeCloseTo(EXPECT.oracle.ndcg5, 12);
  });

  it("does not let the unanswerable query drag any metric down", () => {
    // The whole point of the Phase 2 change: an oracle is now scored as an oracle.
    const withoutUnanswerable = TEST_ROWS.filter((r) => r.relevant.length > 0);
    const sameRanks = ranksOf(oracle, withoutUnanswerable);
    expect(mrr(sameRanks, withoutUnanswerable)).toBeCloseTo(mrr(ranks, TEST_ROWS), 12);
    expect(recallAt(sameRanks, withoutUnanswerable, 5)).toBeCloseTo(
      recallAt(ranks, TEST_ROWS, 5),
      12,
    );
  });

  it("is exactly the ceiling reported by ceilingFor", () => {
    expect(ceilingFor(TEST_ROWS, "mrr")).toBeCloseTo(mrr(ranks, TEST_ROWS), 12);
    expect(ceilingFor(TEST_ROWS, "recall", 1)).toBeCloseTo(recallAt(ranks, TEST_ROWS, 1), 12);
    expect(ceilingFor(TEST_ROWS, "recall", 5)).toBeCloseTo(recallAt(ranks, TEST_ROWS, 5), 12);
    expect(ceilingFor(TEST_ROWS, "precision", 3)).toBeCloseTo(precisionAt(ranks, TEST_ROWS, 3), 12);
    expect(ceilingFor(TEST_ROWS, "ndcg", 5)).toBeCloseTo(ndcgAt(ranks, TEST_ROWS, 5), 12);
  });
});

// ── reversed oracle: the floor ────────────────────────────────────────────
describe("reversed oracle (relevant documents last)", () => {
  const ranks = ranksOf(reversed);

  it("scores MRR 133/2244", () => {
    expect(mrr(ranks, TEST_ROWS)).toBeCloseTo(EXPECT.reversed.mrr, 12);
  });

  it("scores zero on every cut-off metric — nothing relevant reaches the top 5", () => {
    expect(recallAt(ranks, TEST_ROWS, 5)).toBe(0);
    expect(precisionAt(ranks, TEST_ROWS, 3)).toBe(0);
    expect(ndcgAt(ranks, TEST_ROWS, 5)).toBe(0);
  });
});

// ── random: the analytic baseline ─────────────────────────────────────────
describe("random ranker over 100 seeds", () => {
  const seeds = Array.from({ length: 100 }, (_, i) => i);
  const runs = seeds.map((s) => ranksOf((row) => shuffled(s + row.relevant.length * 7919)));
  const mean = (f: (r: number[][]) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;

  it("lands near the closed-form expected MRR", () => {
    expect(mean((r) => mrr(r, TEST_ROWS))).toBeCloseTo(EXPECT.random.mrr, 1);
  });

  it("lands near k/N for recall at each k", () => {
    expect(mean((r) => recallAt(r, TEST_ROWS, 1))).toBeCloseTo(EXPECT.random.r1, 1);
    expect(mean((r) => recallAt(r, TEST_ROWS, 3))).toBeCloseTo(EXPECT.random.r3, 1);
    expect(mean((r) => recallAt(r, TEST_ROWS, 5))).toBeCloseTo(EXPECT.random.r5, 1);
  });

  it("lands near the closed-form expected P@3", () => {
    expect(mean((r) => precisionAt(r, TEST_ROWS, 3))).toBeCloseTo(EXPECT.random.p3, 1);
  });

  it("scores far below the oracle on every metric", () => {
    const o = ranksOf(oracle);
    expect(mean((r) => mrr(r, TEST_ROWS))).toBeLessThan(mrr(o, TEST_ROWS) / 2);
    expect(mean((r) => recallAt(r, TEST_ROWS, 5))).toBeLessThan(recallAt(o, TEST_ROWS, 5) / 2);
  });
});

// ── duplicate injection ───────────────────────────────────────────────────
describe("duplicate chunks", () => {
  it("collapses to first appearance, preserving order", () => {
    expect(dedupDocs([{ docId: "a" }, { docId: "b" }, { docId: "a" }, { docId: "c" }])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("leaves every metric unchanged when each chunk is indexed twice", () => {
    const doubled = (row: Labeled) =>
      dedupDocs(oracle(row).flatMap((d) => [{ docId: d }, { docId: d }]));
    const plain = ranksOf(oracle);
    const dup = ranksOf(doubled);
    expect(dup).toEqual(plain);
    expect(mrr(dup, TEST_ROWS)).toBeCloseTo(mrr(plain, TEST_ROWS), 12);
    expect(recallAt(dup, TEST_ROWS, 5)).toBeCloseTo(recallAt(plain, TEST_ROWS, 5), 12);
    expect(precisionAt(dup, TEST_ROWS, 3)).toBeCloseTo(precisionAt(plain, TEST_ROWS, 3), 12);
    expect(ndcgAt(dup, TEST_ROWS, 5)).toBeCloseTo(ndcgAt(plain, TEST_ROWS, 5), 12);
  });

  it("would double-count without the dedup — proving the guard does work", () => {
    // Two chunks of the same relevant document at ranks 1 and 2, not collapsed.
    const undeduped = [[1, 2]];
    const rows: Labeled[] = [{ relevant: ["a"] }];
    expect(recallAt(undeduped, rows, 3)).toBe(2); // recall above 1.0 — the failure mode
    expect(recallAt([[1]], rows, 3)).toBe(1);
  });
});

// ── degenerate input ──────────────────────────────────────────────────────
describe("degenerate input", () => {
  const finite = (v: number) => {
    expect(Number.isNaN(v)).toBe(false);
    expect(Number.isFinite(v)).toBe(true);
  };

  it("returns 0 for an empty query set rather than NaN", () => {
    finite(mrr([], []));
    finite(recallAt([], [], 5));
    finite(precisionAt([], [], 3));
    finite(ndcgAt([], [], 5));
    expect([mrr([], []), recallAt([], [], 5), precisionAt([], [], 3), ndcgAt([], [], 5)]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("handles rankings that found nothing", () => {
    const rows: Labeled[] = [{ relevant: ["a"] }, { relevant: ["b"] }];
    const empty = [[], []];
    expect(mrr(empty, rows)).toBe(0);
    expect(recallAt(empty, rows, 5)).toBe(0);
    expect(ndcgAt(empty, rows, 5)).toBe(0);
  });

  it("does not divide by zero when every query is unanswerable", () => {
    // Every metric now divides by the judged count, which is 0 here — the guard that matters.
    const rows: Labeled[] = [{ relevant: [] }, { relevant: [] }];
    finite(mrr([[], []], rows));
    finite(recallAt([[], []], rows, 5));
    finite(precisionAt([[], []], rows, 3));
    finite(ndcgAt([[], []], rows, 5));
    expect(mrr([[], []], rows)).toBe(0);
    expect(recallAt([[], []], rows, 5)).toBe(0);
    expect(ndcgAt([[], []], rows, 5)).toBe(0);
    expect(ceilingFor(rows, "mrr")).toBe(0);
  });

  it("ranksForQuery returns no ranks when the ranking is empty", () => {
    expect(ranksForQuery([], ["a"])).toEqual([]);
    expect(ranksForQuery(["x", "y"], [])).toEqual([]);
  });
});
