import { describe, expect, it } from "vitest";
import { rerankScoreFromLogits } from "@/lib/rerank";

describe("rerankScoreFromLogits", () => {
  it("uses a single regression logit directly", () => {
    expect(rerankScoreFromLogits([2.5])).toBe(2.5);
    expect(rerankScoreFromLogits([-1])).toBe(-1);
  });

  it("uses the positive class probability for binary classifiers", () => {
    expect(rerankScoreFromLogits([0, 2])).toBeGreaterThan(0.8);
    expect(rerankScoreFromLogits([2, 0])).toBeLessThan(0.2);
  });

  it("sorts empty logits last", () => {
    expect(rerankScoreFromLogits([])).toBe(Number.NEGATIVE_INFINITY);
  });
});
