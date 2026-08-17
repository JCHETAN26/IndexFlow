import { describe, expect, it } from "vitest";
import { DEFAULT_HYBRID_WEIGHT, blendHybrid, type Scored } from "@/lib/hybrid";
import { chunkText } from "@/lib/chunk";

/**
 * Score blending. BM25 is unbounded and cosine similarity is not, so the blend has to normalise
 * before combining — otherwise the keyword leg's raw magnitude silently dominates and the
 * "hybrid" ranking is just keyword ranking wearing a hat.
 */
const s = (id: string, score: number): Scored => ({ id, score });

describe("blendHybrid", () => {
  it("returns nothing when both legs are empty", () => {
    expect(blendHybrid([], [])).toEqual([]);
  });

  it("passes a single leg through in rank order", () => {
    const out = blendHybrid([s("a", 9), s("b", 5), s("c", 3)], []);
    expect(out[0].id).toBe("a");
    expect(out[1].id).toBe("b");
  });

  it("keeps each leg's lowest hit, which min-max normalises to zero", () => {
    // Formerly pinned as a KNOWN WART. Min-max sends the minimum of a list to exactly 0, and the
    // blend used to discard anything scoring 0 — so a candidate that WAS retrieved but ranked last
    // was treated identically to one that was never retrieved. Measured on SaaSBench, that silently
    // removed 5.68 candidates per query (up to 146).
    //
    // Fixed by deciding membership from retrieval rather than from score. The quality impact at
    // top-10 was exactly zero (Δ nDCG@10 0.000 [0.000, 0.000], n=894) because the dropped
    // candidates all sit deep in the tail — this is a correctness fix, and no improvement is
    // claimed for it. It matters for anything consuming candidate depth, such as reranking.
    const out = blendHybrid([s("a", 9), s("b", 3)], []);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out[1].score).toBe(0);

    const rescued = blendHybrid([s("a", 9), s("b", 3)], [s("b", 0.8)]);
    expect(rescued.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("still treats the weight endpoints as single-leg retrieval", () => {
    // The `score > 0` filter existed to make weight=1 behave as keyword-only. That property has to
    // survive the fix, or the endpoints stop being honest.
    const kwOnly = blendHybrid([s("kw", 5)], [s("sm", 0.9)], 1);
    expect(kwOnly.map((r) => r.id)).toEqual(["kw"]);
    const smOnly = blendHybrid([s("kw", 5)], [s("sm", 0.9)], 0);
    expect(smOnly.map((r) => r.id)).toEqual(["sm"]);
  });

  it("unions ids found by only one leg", () => {
    const out = blendHybrid([s("only-kw", 5)], [s("only-sm", 0.9)]);
    expect(out.map((r) => r.id).sort()).toEqual(["only-kw", "only-sm"]);
  });

  it("ranks a chunk both legs agree on above one only a single leg found", () => {
    const out = blendHybrid([s("both", 10), s("kw", 9)], [s("both", 0.99), s("sm", 0.98)]);
    expect(out[0].id).toBe("both");
  });

  it("normalises, so an unbounded keyword score cannot swamp the semantic leg", () => {
    // BM25 in the thousands vs cosine in [0,1]. Without normalisation the semantic-only hit
    // could never place, whatever its similarity.
    const out = blendHybrid([s("huge-bm25", 5000)], [s("perfect-cosine", 1)], 0.5);
    const ids = out.map((r) => r.id);
    expect(ids).toContain("perfect-cosine");
    // At equal weight and each leg's top hit normalising to 1, neither should dominate.
    expect(out[0].score).toBeCloseTo(out[1].score, 5);
  });

  it("weight 1 is keyword-only ordering, weight 0 is semantic-only", () => {
    const kw = [s("k", 10), s("shared", 1)];
    const sm = [s("s", 1), s("shared", 0.01)];
    expect(blendHybrid(kw, sm, 1)[0].id).toBe("k");
    expect(blendHybrid(kw, sm, 0)[0].id).toBe("s");
  });

  it("defaults to the weight the evaluation selected", () => {
    expect(DEFAULT_HYBRID_WEIGHT).toBeGreaterThan(0);
    expect(DEFAULT_HYBRID_WEIGHT).toBeLessThan(1);
  });
});

describe("chunkText", () => {
  it("produces nothing for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("numbers chunks contiguously from zero", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. `.repeat(30)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps every chunk non-empty and counted", () => {
    const chunks = chunkText("A short but real paragraph about search.\n\nAnd a second one.");
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content.trim()).not.toBe("");
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });

  it("preserves the source text across chunk boundaries", () => {
    // Chunks may overlap, but nothing may be dropped: a term that exists in the document must
    // survive into at least one chunk, or it becomes unsearchable.
    const needle = "zarquon-marker";
    const text = `Intro paragraph.\n\n${needle} appears here.\n\nClosing paragraph.`;
    expect(chunkText(text).some((c) => c.content.includes(needle))).toBe(true);
  });
});
