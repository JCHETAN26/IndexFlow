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
