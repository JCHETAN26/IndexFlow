export interface Scored {
  id: string;
  score: number;
}

/**
 * Keyword weight in [0, 1] for the hybrid blend; semantic weight is (1 - weight).
 * Chosen by the weight sweep in the eval harness, not guessed. Re-run `pnpm eval`
 * after corpus changes and update this if the sweep's best weight moves.
 */
export const DEFAULT_HYBRID_WEIGHT = 0.5;

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
    const score = weight * (kw.get(id) ?? 0) + (1 - weight) * (sm.get(id) ?? 0);
    // Drop items with no contribution under this weight (e.g. at weight=1 a
    // semantic-only hit scores 0). Keeps the endpoints honest: weight=1 behaves
    // like keyword-only, weight=0 like semantic-only.
    if (score > 0) blended.push({ id, score });
  }
  blended.sort((a, b) => b.score - a.score);
  return blended;
}
