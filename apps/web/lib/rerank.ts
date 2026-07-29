import { AutoModelForSequenceClassification, AutoTokenizer, softmax } from "@huggingface/transformers";
import type { Candidate } from "./retrieve";

/**
 * Cross-encoder reranking.
 *
 * Retrieval gives us a cheap shortlist. The reranker then scores each (query, passage) pair
 * jointly in one sequence-classification model. That is the important bit: the model sees both
 * strings at the same time, so it can judge relevance directly instead of comparing independent
 * vectors. It is slower than keyword/vector retrieval, so callers only pass top-k candidates.
 */

export const RERANK_MODEL = "Xenova/bge-reranker-base";

export type RerankCandidate = Candidate & { content?: string };

interface Reranker {
  tokenizer: any;
  model: any;
}

// Global cache so the tokenizer/model load only once per worker/process.
let reranker: Promise<Reranker> | null = null;

async function getReranker(): Promise<Reranker> {
  reranker ??= Promise.all([
    AutoTokenizer.from_pretrained(RERANK_MODEL),
    AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL),
  ]).then(([tokenizer, model]) => ({ tokenizer, model }));
  return reranker;
}

export function rerankScoreFromLogits(logits: number[]): number {
  if (logits.length === 0) return Number.NEGATIVE_INFINITY;
  // Many rerankers are regression-style models with a single relevance logit. Raw logit is fine
  // for ranking because only ordering matters. Two-class classifiers use the positive class.
  if (logits.length === 1) return logits[0];
  const probs = Array.from(softmax(logits));
  return probs[1] ?? probs[probs.length - 1] ?? Number.NEGATIVE_INFINITY;
}

function passageText(c: RerankCandidate): string {
  return (c.content ?? c.snippet ?? "").replace(/@@HL_START@@|@@HL_END@@/g, "");
}

export async function rerank(query: string, candidates: RerankCandidate[]): Promise<Candidate[]> {
  if (candidates.length === 0) return [];

  const { tokenizer, model } = await getReranker();
  const queries = candidates.map(() => query);
  const passages = candidates.map(passageText);
  const inputs = tokenizer(queries, {
    text_pair: passages,
    padding: true,
    truncation: true,
  });
  const outputs = await model(inputs);
  const rows = outputs.logits.tolist() as number[][];

  const scoredCandidates = candidates.map((c, i) => ({
    ...c,
    score: rerankScoreFromLogits(rows[i] ?? []),
  }));

  return scoredCandidates.sort((a, b) => b.score - a.score);
}
