export interface Scored {
  id: string;
  score: number;
}

/**
 * Keyword weight in [0, 1] for the hybrid blend; semantic weight is (1 - weight).
 * Chosen by the weight sweep in the eval harness, not guessed. Re-run `pnpm eval`
 * after corpus/backend changes and update this if the sweep's best weight moves.
 *
 * History, because this constant drifted from the sweep once and the drift was invisible:
 * Elasticsearch BM25 scores moved the optimum 0.5 → 0.4; the IF-3 held-out split then selected
 * 0.55, and this constant was NOT updated, so production served 0.4 while every published hybrid
 * number described 0.55. Re-selected at 0.45 on 2026-08-05 once the harness was fixed to retrieve
 * at production depth on both legs. The sweep plateau is wide and flat (0.20–0.70 all score 0.98
 * on the tuning split), so treat this as the centre of a plateau, not a sharp optimum.
 */
export const DEFAULT_HYBRID_WEIGHT = 0.45;

/** Min-max normalize scores to [0, 1] within a single list (keyed by id). */
function normalize(items: Scored[]): Map<string, number> {
  const out = new Map<string, number>();
  if (items.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const i of items) {
    if (i.score < min) min = i.score;
    if (i.score > max) max = i.score;
  }
  const range = max - min;
  for (const i of items) {
    // All-equal scores → treat every present item as fully relevant (1).
    out.set(i.id, range === 0 ? 1 : (i.score - min) / range);
  }
  return out;
}

/**
 * Blend two scored lists into one ranked list.
 *
 * Keyword (ts_rank) and semantic (cosine) scores live on different scales, so each
 * list is min-max normalized before blending. An item missing from a list contributes
 * 0 for that component, so items found by both strategies are naturally rewarded.
 */
export function blendHybrid(
  keyword: Scored[],
  semantic: Scored[],
  weight: number = DEFAULT_HYBRID_WEIGHT,
): Scored[] {
  const kw = normalize(keyword);
  const sm = normalize(semantic);
  const ids = new Set<string>([...kw.keys(), ...sm.keys()]);

  const blended: Scored[] = [];
  for (const id of ids) {
    // Membership is decided by which leg RETRIEVED the candidate, not by its score.
    //
    // This previously tested `score > 0`, which conflated two different questions. Min-max maps the
    // lowest score in a list to exactly 0, so a candidate that was retrieved but happened to rank
    // last was indistinguishable from one that was never retrieved at all — and was discarded.
    // Measured on SaaSBench: 5.68 candidates silently dropped per query, up to 146. The endpoints
    // still behave exactly as before, because a leg only confers membership when it carries weight.
    const inKeyword = kw.has(id);
    const inSemantic = sm.has(id);
    if (!((weight > 0 && inKeyword) || (weight < 1 && inSemantic))) continue;
    blended.push({ id, score: weight * (kw.get(id) ?? 0) + (1 - weight) * (sm.get(id) ?? 0) });
  }
  // Ties broken by id: once minimums are no longer discarded, several candidates can legitimately
  // share a score, and a stable order keeps ranking deterministic.
  blended.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return blended;
}
