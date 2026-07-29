/**
 * Lightweight usage/cost telemetry for the public demo and local ops.
 *
 * This is deliberately in-memory, matching lib/ratelimit. It gives an operator a live view of
 * request volume, uploaded bytes, answer tokens, and rough local-model "cost units" without
 * pretending to be billing-grade. In multi-process deployments, aggregate at the edge/OTel layer.
 */

export interface UsageSnapshot {
  startedAt: string;
  searchRequests: number;
  answerRequests: number;
  uploadRequests: number;
  uploadedBytes: number;
  evalRuns: number;
  answerInputTokens: number;
  answerOutputTokens: number;
}

const state: UsageSnapshot = {
  startedAt: new Date().toISOString(),
  searchRequests: 0,
  answerRequests: 0,
  uploadRequests: 0,
  uploadedBytes: 0,
  evalRuns: 0,
  answerInputTokens: 0,
  answerOutputTokens: 0,
};

export function recordSearch(): void {
  state.searchRequests += 1;
}

export function recordUpload(bytes: number): void {
  state.uploadRequests += 1;
  state.uploadedBytes += Math.max(0, bytes);
}

export function recordEvalRun(): void {
  state.evalRuns += 1;
}

export function recordAnswerUsage(inputTokens: number | null, outputTokens: number | null): void {
  state.answerRequests += 1;
  state.answerInputTokens += Math.max(0, inputTokens ?? 0);
  state.answerOutputTokens += Math.max(0, outputTokens ?? 0);
}

export function usageSnapshot(): UsageSnapshot & { estimatedLocalModelTokenUnits: number } {
  return {
    ...state,
    // Local Ollama has no API bill, but tokens still represent host work. Weight input lightly
    // because generation dominates wall time on this app's small prompts.
    estimatedLocalModelTokenUnits: state.answerInputTokens * 0.25 + state.answerOutputTokens,
  };
}
