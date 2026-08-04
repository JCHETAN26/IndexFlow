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

/**
 * Mean recall@k.
 *
 * NOTE the denominator: queries with no relevant documents are skipped in the numerator but still
 * counted in `rankings.length`. That caps this metric below 1 whenever the set contains an
 * unanswerable query — see `ceilingFor`.
 */
export function recallAt(rankings: number[][], evals: Labeled[], k: number): number {
  if (rankings.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rankings.length; i++) {
    const total = evals[i].relevant.length;
    if (total === 0) continue;
    sum += rankings[i].filter((r) => r <= k).length / total;
  }
  return sum / rankings.length;
}

/** Mean reciprocal rank of the first relevant document. No relevant document found scores 0. */
export function mrr(rankings: number[][]): number {
  if (rankings.length === 0) return 0;
  return rankings.reduce<number>((s, r) => s + (r.length > 0 ? 1 / r[0] : 0), 0) / rankings.length;
}

/**
 * Mean precision@k. Divides by k, not by min(k, total) — the standard convention, but it means a
 * query with one relevant document can score at most 1/k. On a corpus labelled one-doc-per-query
 * that puts the attainable maximum near 1/k, which is easy to misread as a poor score.
 */
export function precisionAt(rankings: number[][], k: number): number {
  if (rankings.length === 0) return 0;
  return (
    rankings.reduce<number>((sum, r) => sum + r.filter((x) => x <= k).length / k, 0) /
    rankings.length
  );
}

/**
 * Mean nDCG@k with binary gain.
 *
 * DCG sums 1/log2(rank+1) over relevant documents inside the cut; IDCG is the same sum over the
 * first min(k, total) positions. Same denominator caveat as `recallAt`.
 */
export function ndcgAt(rankings: number[][], evals: Labeled[], k: number): number {
  if (rankings.length === 0) return 0;
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
  return sum / rankings.length;
}

/**
 * The best score a perfect ranker could achieve on this label set — the value an oracle that puts
 * every relevant document at the top would score.
 *
 * This is not a theoretical nicety. Two properties of the label set hold every metric below 1:
 *
 *  1. A query with no relevant documents contributes 0 to the numerator and 1 to the denominator,
 *     so every metric is capped at judged/total.
 *  2. recall@k is capped at min(k, total)/total per query, and precision@k at min(k, total)/k, so
 *     a set labelled one-relevant-document-per-query caps P@k near 1/k and R@1 below 1.
 *
 * Reporting a score without its ceiling is how a saturated benchmark passes for a good one: on
 * this corpus R@5 = 97% is not "97% of documents found", it is 100% of what is findable.
 */
export function ceilingFor(evals: Labeled[], metric: "mrr" | "ndcg", k?: number): number;
export function ceilingFor(evals: Labeled[], metric: "recall" | "precision", k: number): number;
export function ceilingFor(
  evals: Labeled[],
  metric: "mrr" | "recall" | "precision" | "ndcg",
  k = 0,
): number {
  const n = evals.length;
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
