/**
 * Structural gates — properties checkable without running retrieval at all.
 *
 * The metric gate needed five runs, each costing minutes of embedding, to find defects that were
 * visible in the generated data the whole time. Worse, it could only ever see them *through* a
 * score, which is ambiguous by nature: a low number reads equally well as "hard benchmark" or
 * "broken benchmark", and twice it was read the wrong way.
 *
 * These checks are unambiguous and run in milliseconds. They encode the pre-registered structural
 * rule directly:
 *
 *   1. Every query's anchor must match SEVERAL scenarios. If a service name identifies exactly one
 *      incident, BM25 wins by finding a unique token and the benchmark measures entity lookup.
 *   2. The target must NOT be uniquely identifiable from its anchor alone.
 *   3. Every query must have at least one same-anchor competitor carrying a different fault, so the
 *      symptom is what resolves the query.
 *   4. Scenarios sharing an anchor must carry DISTINCT faults, or the query is unanswerable.
 *   5. After removing anchor terms, a paraphrase query must retain low lexical overlap with its
 *      target's documents — otherwise the vocabularies have leaked — while still carrying enough
 *      information to determine the answer.
 *
 * Rules 1-3 guard against making retrieval artificially trivial. Rules 4-5 guard against making it
 * artificially impossible. This project has shipped both mistakes, which is why both directions are
 * checked rather than just the one that happened most recently.
 */
import type { Scenario } from "./scenarios";
import type { SaasDoc } from "./documents";
import type { SaasQuery } from "./queries";
// One definition of "content word", shared with the concept-level disjointness check. Two lists
// meant two answers to the same question about whether a word carries signal.
import { STOPWORDS as STOP } from "./lexicon";

export interface StructuralViolation {
  rule: string;
  detail: string;
  count: number;
  examples: string[];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Tokens belonging to the anchor — the entity names a query is allowed to share with documents. */
function anchorTokens(s: Scenario): Set<string> {
  return new Set([
    ...words(s.service),
    ...words(s.platform),
    ...words(s.errorCode),
    ...words(s.id),
    ...words(s.team),
    ...words(s.environment),
    ...words(String(s.quantity.value)),
    ...words(s.quantity.unit),
    ...words(s.affectedVersion),
    ...words(s.resolvedVersion),
  ]);
}

export interface StructuralOptions {
  /** Anchor must match at least this many core scenarios. */
  minScenariosPerAnchor: number;
  /** Maximum share of non-anchor, DISCRIMINATIVE query words that may appear in the target's docs. */
  maxParaphraseOverlap: number;
  /**
   * A shared word only counts as a leak if it appears in fewer than this share of documents.
   *
   * Overlap alone is the wrong test. "team" and "service" appear in nearly every document, so their
   * inverse document frequency is near zero and BM25 gains essentially nothing from matching them —
   * flagging those produced 23 violations that were query scaffolding, not planted text. What makes
   * a leak dangerous is a *rare* word shared between the query and its target, because that is
   * exactly what BM25 scores highly. Modelling the mechanism beats maintaining a stopword list by
   * hand, and it cannot drift out of date as the templates change.
   */
  maxDocFrequency: number;
}

export const DEFAULT_STRUCTURAL: StructuralOptions = {
  minScenariosPerAnchor: 2,
  maxParaphraseOverlap: 0.25,
  maxDocFrequency: 0.1,
};

export function checkStructure(
  scenarios: Scenario[],
  documents: SaasDoc[],
  queries: SaasQuery[],
  opts: StructuralOptions = DEFAULT_STRUCTURAL,
): StructuralViolation[] {
  const violations: StructuralViolation[] = [];
  const core = scenarios.filter((s) => s.kind === "core");
  const byId = new Map(scenarios.map((s) => [s.id, s]));

  const anchorKey = (s: Scenario) => `${s.service}|${s.platform}`;
  const byAnchor = new Map<string, Scenario[]>();
  for (const s of core) {
    const k = anchorKey(s);
    const list = byAnchor.get(k);
    if (list) list.push(s);
    else byAnchor.set(k, [s]);
  }

  // ── rule 1 + 2: anchors must be ambiguous ───────────────────────────────
  const lonely = [...byAnchor.entries()].filter(([, v]) => v.length < opts.minScenariosPerAnchor);
  if (lonely.length > 0) {
    violations.push({
      rule: "anchor-uniquely-identifies-target",
      detail:
        `An anchor matching one scenario turns the service name into an identifier, and BM25 wins ` +
        `by finding a unique token rather than by understanding the query.`,
      count: lonely.length,
      examples: lonely.slice(0, 5).map(([k, v]) => `${k} -> ${v.length} scenario(s)`),
    });
  }

  // ── rule 4: same anchor must mean different faults ──────────────────────
  const duplicateFault: string[] = [];
  for (const [k, group] of byAnchor) {
    const seen = new Map<string, string[]>();
    for (const s of group) {
      const list = seen.get(s.conceptId);
      if (list) list.push(s.id);
      else seen.set(s.conceptId, [s.id]);
    }
    for (const [concept, ids] of seen) {
      if (ids.length > 1) duplicateFault.push(`${k} · ${concept} -> ${ids.join(", ")}`);
    }
  }
  if (duplicateFault.length > 0) {
    violations.push({
      rule: "same-anchor-same-fault",
      detail:
        `Scenarios sharing an anchor AND a fault are indistinguishable: their documents draw root ` +
        `cause from the same phrasings, so the query has more than one correct answer and exactly ` +
        `one graded relevant. This is the unanswerability defect.`,
      count: duplicateFault.length,
      examples: duplicateFault.slice(0, 5),
    });
  }

  // ── rule 3: every anchored query needs a same-anchor competitor ─────────
  const anchored = queries.filter(
    (q) => q.targetScenarioId && ["paraphrase", "troubleshooting", "version", "multi-document"].includes(q.queryClass),
  );
  const noCompetitor = anchored.filter((q) => {
    const t = byId.get(q.targetScenarioId!);
    if (!t) return false;
    return (byAnchor.get(anchorKey(t))?.length ?? 0) < 2;
  });
  if (noCompetitor.length > 0) {
    violations.push({
      rule: "no-same-anchor-hard-negative",
      detail: `An anchored query with no same-anchor competitor can be answered by the anchor alone.`,
      count: noCompetitor.length,
      examples: noCompetitor.slice(0, 5).map((q) => `${q.id} -> ${q.targetScenarioId}`),
    });
  }

  // ── rule 5: paraphrase must stay paraphrastic once the anchor is removed ─
  const docsByScenario = new Map<string, SaasDoc[]>();
  for (const d of documents) {
    const list = docsByScenario.get(d.scenarioId);
    if (list) list.push(d);
    else docsByScenario.set(d.scenarioId, [d]);
  }
  // Corpus document frequency, so the check can tell a discriminative shared word from boilerplate.
  const df = new Map<string, number>();
  for (const d of documents) {
    for (const w of new Set(words(`${d.title} ${d.body}`))) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const rare = (w: string) => (df.get(w) ?? 0) / documents.length < opts.maxDocFrequency;

  const leaky: string[] = [];
  let checked = 0;
  for (const q of queries) {
    if (q.queryClass !== "paraphrase" && q.queryClass !== "troubleshooting") continue;
    const t = q.targetScenarioId ? byId.get(q.targetScenarioId) : undefined;
    if (!t) continue;
    const anchor = anchorTokens(t);
    // Only discriminative words count: an anchor term is allowed to match by design, and a term
    // present across the corpus carries no signal for BM25 to exploit.
    const qWords = words(q.text).filter((w) => !anchor.has(w) && rare(w));
    if (qWords.length === 0) continue;
    const docWords = new Set(
      (docsByScenario.get(t.id) ?? []).flatMap((d) => words(`${d.title} ${d.body}`)),
    );
    const shared = qWords.filter((w) => docWords.has(w));
    checked++;
    if (shared.length / qWords.length > opts.maxParaphraseOverlap) {
      leaky.push(`${q.id} overlap ${(shared.length / qWords.length).toFixed(2)}: ${shared.join(", ")}`);
    }
  }
  if (leaky.length > 0) {
    violations.push({
      rule: "paraphrase-lexical-leak",
      detail:
        `With anchor terms and corpus-wide boilerplate removed, these queries still share more than ` +
        `${(opts.maxParaphraseOverlap * 100).toFixed(0)}% of their discriminative words with the ` +
        `target's documents. The vocabularies have leaked and BM25 can match planted text.`,
      count: leaky.length,
      examples: leaky.slice(0, 5),
    });
  }
  void checked;

  return violations;
}

/** Human-readable summary of the anchor neighbourhood, for the gate's report. */
export function anchorSummary(scenarios: Scenario[]): string {
  const core = scenarios.filter((s) => s.kind === "core");
  const byAnchor = new Map<string, number>();
  for (const s of core) {
    const k = `${s.service}|${s.platform}`;
    byAnchor.set(k, (byAnchor.get(k) ?? 0) + 1);
  }
  const sizes = [...byAnchor.values()].sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  return `${core.length} core scenarios across ${byAnchor.size} anchors · ${sizes[0]}-${sizes[sizes.length - 1]} per anchor (median ${median})`;
}
