import { retrieveContexts, type RetrievedContext } from "@/lib/retrieve";
import { streamAnswer, type AnswerContext } from "@/lib/llm";
import type { Viewer } from "@/lib/acl";

/**
 * RAG orchestration: hybrid retrieval (lib/retrieve) → grounded answer (lib/llm).
 * Retrieval and generation are separate so the search route, the answer route, and the
 * generation eval all share one retriever and one prompt.
 *
 * The answer inherits the viewer's ACL: contexts come from the permission-aware
 * retriever, so the generator can only ever ground (and cite) documents the viewer is
 * allowed to see — a restricted document cannot leak into an answer even indirectly.
 */

export const RAG_K = 6;

export function toAnswerContexts(contexts: RetrievedContext[]): AnswerContext[] {
  return contexts.map((c) => ({ marker: c.marker, title: c.title, content: c.content }));
}

/**
 * Retrieve, then return the answer as a provider-neutral event stream. `answer` is null
 * when nothing was retrieved, so the caller can refuse without spending a generation.
 */
export async function answerQuestion(query: string, viewer: Viewer, k = RAG_K) {
  const contexts = await retrieveContexts(query, k, viewer);
  const answer = contexts.length > 0 ? streamAnswer(query, toAnswerContexts(contexts)) : null;
  return { contexts, answer };
}
