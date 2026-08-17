import { describe, expect, it } from "vitest";
import { findLexiconLeaks, CONCEPTS } from "../../eval/saasbench/lexicon";
import { buildSnapshot } from "../../eval/saasbench/generate";
import { Rng } from "../../eval/saasbench/rng";
import { checkStructure } from "../../eval/saasbench/structural";

/**
 * The generator's own invariants.
 *
 * These are not tests of retrieval quality — that is the gate's job, and it needs real services.
 * These are the properties that make the corpus worth measuring at all, and each one has already
 * been violated at least once during development, which is why they are pinned here rather than
 * trusted.
 */
describe("saasbench lexicon", () => {
  it("keeps document and query vocabularies disjoint", () => {
    // The anti-circularity invariant. Nine of eighteen concepts leaked on first authoring —
    // "write", "account", "payment", "preview", "rows", "changes", "edits", "text", "healthy",
    // "everyone" — every one of which would have let BM25 match a phrase the generator planted.
    const leaks = findLexiconLeaks();
    expect(
      leaks.map((l) => `${l.conceptId}: ${l.shared.join(", ")}`),
      "document and query vocabularies overlap; reword one side",
    ).toEqual([]);
  });

  it("gives every concept both voices", () => {
    for (const c of CONCEPTS) {
      expect(c.docPhrases.length, `${c.id} docPhrases`).toBeGreaterThan(0);
      expect(c.userPhrases.length, `${c.id} userPhrases`).toBeGreaterThan(0);
      expect(c.docFixes.length, `${c.id} docFixes`).toBeGreaterThan(0);
      expect(c.userGoals.length, `${c.id} userGoals`).toBeGreaterThan(0);
    }
  });
});

describe("saasbench rng", () => {
  it("is reproducible from a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const drawsA = Array.from({ length: 50 }, () => a.next());
    const drawsB = Array.from({ length: 50 }, () => b.next());
    expect(drawsA).toEqual(drawsB);
  });

  it("forks into independent streams", () => {
    // Stream isolation is what lets the query set change without disturbing the corpus. If a fork
    // leaked into its parent, editing query generation would silently reshuffle every document.
    const parent = new Rng(7);
    const first = parent.fork("docs").next();
    const parent2 = new Rng(7);
    parent2.fork("queries").next();
    expect(parent2.fork("docs").next()).toBe(first);
  });
});

describe("saasbench snapshot", () => {
  // Generation embeds nothing and touches no services, but it does realise several thousand
  // documents, so give it room.
  it("is byte-identical for the same seed", async () => {
    const a = await buildSnapshot(1200, 42);
    const b = await buildSnapshot(1200, 42);
    expect(a.manifest.corpusHash).toBe(b.manifest.corpusHash);
    expect(a.manifest.queriesHash).toBe(b.manifest.queriesHash);
    expect(a.manifest.qrelsHash).toBe(b.manifest.qrelsHash);
  }, 60_000);

  it("differs for a different seed", async () => {
    const a = await buildSnapshot(1200, 42);
    const b = await buildSnapshot(1200, 43);
    expect(a.manifest.corpusHash).not.toBe(b.manifest.corpusHash);
  }, 60_000);

  it("has unique document ids", async () => {
    // Filler restarts its scenario sequence at zero, so without a distinct id prefix a background
    // scenario takes an incident's id and two documents collide. That surfaced as a Postgres
    // unique violation hundreds of lines downstream.
    const snap = await buildSnapshot(1200, 42);
    const ids = new Set(snap.documents.map((d) => d.id));
    expect(ids.size).toBe(snap.documents.length);
  }, 60_000);

  it("never grades a document that is not in the corpus", async () => {
    const snap = await buildSnapshot(1200, 42);
    const present = new Set(snap.documents.map((d) => d.id));
    const dangling = snap.queries.flatMap((q) => Object.keys(q.qrels).filter((d) => !present.has(d)));
    expect(dangling).toEqual([]);
  }, 60_000);

  it("keeps every hard negative distinguishable from the core it shadows", async () => {
    // A sibling sharing BOTH service and platform cannot be separated by an anchored query, so it
    // is not a hard negative — it is an unresolvable choice, and scoring it as a miss charges the
    // retriever for a distinction the query never expressed. Two per core scenario held nDCG@10
    // near 0.11 for every strategy before this was found.
    const snap = await buildSnapshot(1200, 42);
    const core = new Map(snap.scenarios.filter((s) => s.kind === "core").map((s) => [s.id, s]));
    const unresolvable = snap.scenarios.filter((s) => {
      if (s.kind !== "hard-negative" || s.discriminator === "superseded" || !s.nearId) return false;
      const c = core.get(s.nearId);
      return !!c && c.service === s.service && c.platform === s.platform;
    });
    expect(unresolvable.map((s) => `${s.id}/${s.discriminator}`)).toEqual([]);
  }, 60_000);

  it("keeps the query set invariant to corpus size", async () => {
    // The property that makes a scale curve honest: only the haystack grows. If queries or qrels
    // shifted with corpus size, a curve would be comparing two different benchmarks.
    // Both sizes must sit ABOVE the labelled anchor's floor, or the generator returns the floor
    // for both and the test passes without comparing anything.
    const small = await buildSnapshot(3400, 42);
    const large = await buildSnapshot(5000, 42);
    expect(small.manifest.queriesHash).toBe(large.manifest.queriesHash);
    expect(small.manifest.qrelsHash).toBe(large.manifest.qrelsHash);
    expect(large.documents.length).toBeGreaterThan(small.documents.length);
  }, 90_000);
});

describe("saasbench frozen benchmark", () => {
  /**
   * The benchmark is frozen by hash, not by committing its bytes.
   *
   * The corpus regenerates deterministically from the seed, so storing 2.5 MB of JSONL in git would
   * be storing a derivative. What must not drift silently is what the benchmark *is* — so the
   * canonical manifest's hashes are committed and this test regenerates from the seed and compares.
   * A change to any generation logic now fails here, which forces the choice to be deliberate:
   * either the change was unintended, or `frozen.json` and GENERATOR_VERSION are updated together
   * and every previously published number is understood to describe a different benchmark.
   */
  it("reproduces the frozen manifest hashes", async () => {
    const frozen = (await import("../../eval/saasbench/frozen.json")).default;
    const snap = await buildSnapshot(frozen.docs, frozen.seed);
    expect(snap.manifest.generatorVersion, "bump frozen.json alongside GENERATOR_VERSION").toBe(
      frozen.generatorVersion,
    );
    expect(snap.manifest.corpusHash, "corpus drifted from the frozen benchmark").toBe(frozen.corpusHash);
    expect(snap.manifest.queriesHash, "query set drifted from the frozen benchmark").toBe(frozen.queriesHash);
    expect(snap.manifest.qrelsHash, "relevance judgments drifted from the frozen benchmark").toBe(frozen.qrelsHash);
    expect(snap.manifest.queries.total).toBe(frozen.queries);
  }, 120_000);
});

describe("saasbench structural gates", () => {
  /**
   * These encode the pre-registered anchor rule and run without any service, so the defect class
   * that took the metric gate five expensive runs to surface now fails in milliseconds — and
   * unambiguously, rather than through a score that reads equally well as "hard" or "broken".
   */
  it("satisfies every structural rule", async () => {
    const snap = await buildSnapshot(3400, 42);
    const violations = checkStructure(snap.scenarios, snap.documents, snap.queries);
    expect(
      violations.map((v) => `${v.rule} (${v.count}): ${v.examples[0] ?? ""}`),
      "structural rules violated; see eval/saasbench/structural.ts for what each one protects",
    ).toEqual([]);
  }, 120_000);

  it("gives every anchor an ambiguity neighbourhood", async () => {
    // The property that keeps the benchmark from degenerating into entity lookup: a service name
    // must narrow the corpus, never resolve it.
    const snap = await buildSnapshot(3400, 42);
    const core = snap.scenarios.filter((s) => s.kind === "core");
    const byAnchor = new Map<string, number>();
    for (const s of core) {
      const k = `${s.service}|${s.platform}`;
      byAnchor.set(k, (byAnchor.get(k) ?? 0) + 1);
    }
    const singletons = [...byAnchor.entries()].filter(([, n]) => n < 2);
    expect(singletons.map(([k]) => k)).toEqual([]);
    expect(Math.min(...byAnchor.values())).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
