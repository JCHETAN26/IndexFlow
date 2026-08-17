/**
 * Fusion variants, isolated so the shipping bug and its fix can be measured against each other.
 *
 * `legacyMinMax` reproduces `lib/hybrid.ts` exactly as it shipped, including the tail-drop defect.
 * It exists ONLY so the evaluation can establish an honest before-state; it must never become a
 * production option.
 *
 * ## The defect
 *
 * `normalize()` maps the minimum score in a list to exactly 0, and the blend then drops anything
 * scoring 0. So the lowest-ranked candidate of one leg, when absent from the other, silently
 * disappears from the hybrid candidate set — not because it was irrelevant but because it happened
 * to be last in its list. Retrieving deeper makes it worse, since a longer list means a larger gap
 * between the minimum and everything above it.
 *
 * ## The fix
 *
 * Presence and score are different questions, and the shipping code conflated them by using
 * "score > 0" as a proxy for "was retrieved". The correction tracks membership explicitly: a
 * candidate is included when some leg with non-zero weight actually retrieved it, whatever it
 * scored. That keeps the endpoints honest — at weight 1 the result is still exactly keyword-only —
 * while making it impossible to lose a candidate for being last.
 */
export interface Scored {
  id: string;
  score: number;
}

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
  for (const i of items) out.set(i.id, range === 0 ? 1 : (i.score - min) / range);
  return out;
}

/** Byte-for-byte the shipping behaviour, tail-drop included. Evaluation only. */
export function legacyMinMax(keyword: Scored[], semantic: Scored[], weight: number): Scored[] {
  const kw = normalize(keyword);
  const sm = normalize(semantic);
  const ids = new Set<string>([...kw.keys(), ...sm.keys()]);
  const blended: Scored[] = [];
  for (const id of ids) {
    const score = weight * (kw.get(id) ?? 0) + (1 - weight) * (sm.get(id) ?? 0);
    if (score > 0) blended.push({ id, score });
  }
  blended.sort((a, b) => b.score - a.score);
  return blended;
}

/** Same normalisation and weighting; membership decided by retrieval rather than by score. */
export function correctedMinMax(keyword: Scored[], semantic: Scored[], weight: number): Scored[] {
  const kw = normalize(keyword);
  const sm = normalize(semantic);
  const ids = new Set<string>([...kw.keys(), ...sm.keys()]);
  const blended: Scored[] = [];
  for (const id of ids) {
    const inKeyword = kw.has(id);
    const inSemantic = sm.has(id);
    // A leg only contributes membership when it carries weight, so weight=1 stays keyword-only and
    // weight=0 stays semantic-only, exactly as before.
    if (!((weight > 0 && inKeyword) || (weight < 1 && inSemantic))) continue;
    blended.push({ id, score: weight * (kw.get(id) ?? 0) + (1 - weight) * (sm.get(id) ?? 0) });
  }
  // Ties are broken by id so the ranking is deterministic — several candidates can legitimately
  // share a score once minimums are no longer discarded.
  blended.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return blended;
}

/** How many candidates the legacy path silently discards, for the diagnostic report. */
export function tailDropCount(keyword: Scored[], semantic: Scored[], weight: number): number {
  return correctedMinMax(keyword, semantic, weight).length - legacyMinMax(keyword, semantic, weight).length;
}
