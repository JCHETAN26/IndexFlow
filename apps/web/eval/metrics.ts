/**
 * Retrieval metrics — the measuring instrument.
 *
 * Extracted from harness.ts so the instrument can be tested independently of the retrieval it
 * measures. Every function here is pure: no I/O, no services, no clock. That is what lets the
 * synthetic-ranker suite (test/unit/metrics.test.ts) assert exact values against hand-derived
 * expectations, and it is why these run in the unit job on every push rather than in the
 * services-bound eval job.
 *
 * Behaviour is byte-for-byte what harness.ts computed before the extraction. Where a convention
 * is debatable it is documented rather than silently chosen — see `ceilingFor` for the
 * consequences of the `total === 0` handling.
 */

/** The only thing the metrics need from a labelled query: which documents count as relevant. */
export interface Labeled {
  relevant: string[];
}

/**
 * How many queries a ranking metric is defined over.
 *
 * A query with no relevant document cannot be ranked well or badly — there is nothing to put at
 * rank 1 — so it is excluded from the denominator of every ranking metric rather than scored as a
 * miss. This matches `trec_eval`, which averages only over queries present in the qrels file.
 *
 * Retrieving nothing for an unanswerable query is *correct behaviour*, and the ranking metrics are
 * the wrong instrument to credit it with. It is measured separately as a rejection signal — see
 * the `rejection` block in the eval report.
 */
export const judgedCount = (evals: Labeled[]): number =>
  evals.reduce((n, e) => n + (e.relevant.length > 0 ? 1 : 0), 0);

/**
 * Collapse a chunk-ordered ranking to a document ranking, keeping first appearance.
 *
 * On the current 17-document corpus every document is a single chunk, so this is a no-op; it
 * matters as soon as documents chunk into more than one piece.
 */
export function dedupDocs(ordered: { docId: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of ordered) {
    if (!seen.has(r.docId)) {
      seen.add(r.docId);
      out.push(r.docId);
    }
  }
  return out;
}

/** 1-based ranks at which relevant documents appear, ascending. */
export function ranksForQuery(docs: string[], relevant: string[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (relevant.includes(docs[i])) r.push(i + 1);
  }
  return r;
}

/** Mean recall@k over judged queries. */
export function recallAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    const total = evals[i].relevant.length;
    if (total === 0) continue;
    sum += rankings[i].filter((r) => r <= k).length / total;
  }
  return sum / n;
}

/**
 * Fraction of judged queries with **at least one** relevant document in the top k.
 *
 * This is what people usually mean by "the right answer was first N% of the time", and it is NOT
 * what `recallAt(…, 1)` measures. Recall@1 divides by the number of relevant documents, so a query
 * with two relevant documents can score at most 0.5 at k=1 no matter how good the ranking is — on
 * the in-domain label set that caps recall@1 at 31/33 for a perfect ranker. Hit rate has no such
 * cap: a perfect ranker scores exactly 1.0.
 *
 * Both are reported. Recall@k is the standard and comparable to published baselines; hit rate is
 * the one that means what a reader assumes it means.
 */
export function hitRateAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    if (evals[i].relevant.length === 0) continue;
    if (rankings[i].some((r) => r <= k)) sum += 1;
  }
  return sum / n;
}

/**
 * Mean reciprocal rank of the first relevant document, over judged queries. A judged query whose
 * relevant document was never retrieved scores 0; an unjudged query is not scored at all.
 */
export function mrr(rankings: number[][], evals: Labeled[]): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    if (evals[i].relevant.length === 0) continue;
    sum += rankings[i].length > 0 ? 1 / rankings[i][0] : 0;
  }
  return sum / n;
}

/**
 * Mean precision@k over judged queries. Divides by k, not by min(k, total) — the standard
 * convention, but it means a query with one relevant document can score at most 1/k. On a corpus
 * labelled one-document-per-query that puts the attainable maximum near 1/k, which is easy to
 * misread as a poor score. This is why `ceilingFor` exists and why the report prints it.
 */
export function precisionAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    if (evals[i].relevant.length === 0) continue;
    sum += rankings[i].filter((x) => x <= k).length / k;
  }
  return sum / n;
}

/**
 * Mean nDCG@k with binary gain, over judged queries.
 *
 * DCG sums 1/log2(rank+1) over relevant documents inside the cut; IDCG is the same sum over the
 * first min(k, total) positions — the `ndcg_cut` convention, verified against pytrec_eval.
 */
export function ndcgAt(rankings: number[][], evals: Labeled[], k: number): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    const total = evals[i].relevant.length;
    if (total === 0) continue;
    let idcg = 0;
    for (let j = 1; j <= Math.min(k, total); j++) idcg += 1 / Math.log2(j + 1);
    let dcg = 0;
    for (const rank of rankings[i]) {
      if (rank <= k) dcg += 1 / Math.log2(rank + 1);
    }
    sum += dcg / idcg;
  }
  return sum / n;
}

/**
 * The best score a perfect ranker could achieve on this label set — the value an oracle that puts
 * every relevant document at the top would score.
 *
 * Excluding unanswerable queries removes one cause of a sub-1.0 ceiling, but not the other: label
 * density still binds. recall@k is capped at min(k, total)/total per query and precision@k at
 * min(k, total)/k, so a set labelled one-relevant-document-per-query caps P@3 near 1/3 and holds
 * R@1 below 1 for every multi-relevant query.
 *
 * Reporting a score without its ceiling is how a saturated benchmark passes for a good one, and
 * how a structurally capped metric passes for a bad score. On this corpus P@3 = 36% is not a poor
 * precision — it is 97% of everything attainable.
 */
export function ceilingFor(evals: Labeled[], metric: "mrr" | "ndcg", k?: number): number;
export function ceilingFor(evals: Labeled[], metric: "recall" | "precision", k: number): number;
export function ceilingFor(
  evals: Labeled[],
  metric: "mrr" | "recall" | "precision" | "ndcg",
  k = 0,
): number {
  const n = judgedCount(evals);
  if (n === 0) return 0;
  let sum = 0;
  for (const e of evals) {
    const total = e.relevant.length;
    if (total === 0) continue;
    if (metric === "mrr" || metric === "ndcg") sum += 1;
    else if (metric === "recall") sum += Math.min(k, total) / total;
    else sum += Math.min(k, total) / k;
  }
  return sum / n;
}

/** A metric expressed as a fraction of what this label set makes attainable. */
export const fractionOfCeiling = (value: number, ceiling: number): number =>
  ceiling === 0 ? 0 : value / ceiling;

// ── graded relevance ──────────────────────────────────────────────────────
/**
 * A query whose judgments carry a gain, not just membership.
 *
 * The binary functions above take `rankings: number[][]` — the *positions* of relevant documents —
 * which is sufficient for MRR, recall and precision but throws away which document sits at each
 * position. Graded nDCG needs the gain at each rank, so it takes the ranked document ids instead.
 */
export interface GradedLabeled {
  relevant: Map<string, number>;
}

/** Positions (1-based) of relevant documents, so the binary metrics can score a ranked id list. */
export const ranksFromRanked = (ranked: string[], relevant: Map<string, number>): number[] => {
  const out: number[] = [];
  for (let i = 0; i < ranked.length; i++) if (relevant.has(ranked[i])) out.push(i + 1);
  return out;
};

/**
 * Mean nDCG@k with **linear** gain — `trec_eval`'s `ndcg_cut` convention, so numbers stay
 * comparable to published BEIR baselines. Gain is the judgment value itself (1, or 2 for
 * NFCorpus's higher grade), not 2^rel − 1.
 *
 * The ideal ranking is the query's own gains sorted descending and truncated at k, so a query with
 * more relevant documents than k is not penalised for being unable to show them all.
 */
export function ndcgAtGraded(ranked: string[][], rows: GradedLabeled[], k: number): number {
  const n = rows.reduce((c, r) => c + (r.relevant.size > 0 ? 1 : 0), 0);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const rel = rows[i].relevant;
    if (rel.size === 0) continue;

    let dcg = 0;
    const list = ranked[i] ?? [];
    for (let p = 0; p < Math.min(k, list.length); p++) {
      const gain = rel.get(list[p]) ?? 0;
      if (gain > 0) dcg += gain / Math.log2(p + 2);
    }

    const ideal = [...rel.values()].sort((a, b) => b - a).slice(0, k);
    let idcg = 0;
    for (let p = 0; p < ideal.length; p++) idcg += ideal[p] / Math.log2(p + 2);

    if (idcg > 0) sum += dcg / idcg;
  }
  return sum / n;
}

/** Deterministic mulberry32. Fixed seed so a published interval does not jitter between runs. */
export function seededRandom(seed = 0x9e3779b9): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

/** Percentile bootstrap of the mean: resample with replacement, take the 2.5th/97.5th percentiles. */
export function bootstrapCI(perQuery: number[], samples = 2000): Interval {
  const n = perQuery.length;
  if (n === 0) return { value: 0, lo: 0, hi: 0 };
  const value = perQuery.reduce((a, b) => a + b, 0) / n;
  const rand = seededRandom();
  const means: number[] = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += perQuery[(rand() * n) | 0];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { value, lo: means[Math.floor(0.025 * samples)], hi: means[Math.floor(0.975 * samples) - 1] };
}

export interface Delta extends Interval {
  /** True iff the 95% interval on the paired difference lies wholly above or wholly below zero. */
  excludesZero: boolean;
}

/**
 * Paired percentile bootstrap of a difference between two strategies.
 *
 * The two strategies are scored on the *same* queries, so the correct comparison resamples
 * **query indices** and averages the per-query difference — not the two means independently.
 * Overlapping marginal intervals do not imply an insignificant difference: per-query correlation
 * is variance that the paired difference removes and two marginal intervals keep. On a set this
 * small that difference routinely decides whether a real effect is visible at all.
 *
 * Both vectors must be indexed by the same queries, in the same order.
 */
export function bootstrapDelta(a: number[], b: number[], samples = 2000): Delta {
  if (a.length !== b.length) {
    throw new Error(`bootstrapDelta needs paired vectors, got ${a.length} and ${b.length}`);
  }
  const n = a.length;
  if (n === 0) return { value: 0, lo: 0, hi: 0, excludesZero: false };

  const diff = a.map((x, i) => x - b[i]);
  const value = diff.reduce((s, d) => s + d, 0) / n;
  const rand = seededRandom();
  const means: number[] = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diff[(rand() * n) | 0];
    means.push(sum / n);
  }
  means.sort((x, y) => x - y);
  const lo = means[Math.floor(0.025 * samples)];
  const hi = means[Math.floor(0.975 * samples) - 1];
  return { value, lo, hi, excludesZero: lo > 0 || hi < 0 };
}

/**
 * Top raw retrieval score per query, split by whether the query is answerable.
 *
 * The rejection question — "did the strategy correctly return nothing?" — cannot be asked of the
 * ranking metrics, and cannot be asked of the blended hybrid score at all: `blendHybrid` min-max
 * normalises per query, so the top blended score is 1.0 for every query regardless of whether
 * anything relevant was found. Only raw leg scores carry absolute information, and of those only
 * cosine similarity is comparable across queries; BM25 is not, because its scale moves with the
 * query's term IDFs.
 *
 * So this reports the separation rather than a rate: if the top score on an unanswerable query
 * falls inside the range of top scores on answerable ones, no threshold can tell them apart.
 */
export interface RejectionSignal {
  unanswerableTop: number[];
  answerableTop: { min: number; median: number; max: number };
  /** True iff every unanswerable query scores below every answerable one. */
  separable: boolean;
}

export function rejectionSignal(
  tops: { top: number; answerable: boolean }[],
): RejectionSignal {
  const un = tops.filter((t) => !t.answerable).map((t) => t.top);
  const an = tops.filter((t) => t.answerable).map((t) => t.top).sort((a, b) => a - b);
  const median = an.length === 0 ? 0 : an[Math.floor(an.length / 2)];
  return {
    unanswerableTop: un,
    answerableTop: { min: an[0] ?? 0, median, max: an[an.length - 1] ?? 0 },
    separable: un.length > 0 && an.length > 0 && Math.max(...un) < Math.min(...an),
  };
}
