import { pipeline } from "@huggingface/transformers";
import type { Candidate } from "./retrieve";

/**
 * Cross-encoder reranking function.
 * Loads a Xenova/bge-reranker-base model to re-score a list of candidates against the query.
 * Cross-encoders are much more accurate than bi-encoders for relevance, but slower,
 * which is why we only run them on the top-k retrieved chunks.
 */

// Global cache for the pipeline so it's loaded only once per worker/process.
let rerankerPipeline: any = null;

async function getReranker() {
  if (!rerankerPipeline) {
    // The pipeline returns a function that takes { query, texts } and outputs scores.
    // In @huggingface/transformers, for cross-encoders, it's typically text-classification or zero-shot.
    // For specialized reranking models, 'text-classification' is used where inputs are pairs.
    // bge-reranker-base is supported via text-classification or custom pipeline.
    // Since transformers.js v3 is still in beta, and v2 handles text-classification, 
    // we use a generic sequence classification approach if needed, or if supported natively:
    rerankerPipeline = await pipeline("text-classification", "Xenova/bge-reranker-base");
  }
  return rerankerPipeline;
}

export async function rerank(query: string, candidates: Candidate[]): Promise<Candidate[]> {
  if (candidates.length === 0) return [];

  const ranker = await getReranker();

  // The model expects pairs of [query, document]
  // Array of arrays crashes text-classification in some transformers.js versions,
  // so we process each pair concurrently or iteratively.
  const scoredCandidates = await Promise.all(
    candidates.map(async (c) => {
      const result = await ranker(query, c.snippet || "", { topk: 1 });
      const score = Array.isArray(result) ? result[0].score : (result as any).score;
      return {
        ...c,
        score
      };
    })
  );

  // Sort strictly descending by the new reranker score
  return scoredCandidates.sort((a, b) => b.score - a.score);
}
