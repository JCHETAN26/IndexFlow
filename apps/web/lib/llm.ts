import { Ollama } from "ollama";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("indexflow-web");

/**
 * Local LLM layer for Stage B (grounded RAG answers + LLM-as-judge eval), served entirely
 * by Ollama — no API keys, no network, consistent with the local MiniLM embeddings. This
 * file is the only provider-specific seam: it exposes provider-neutral shapes
 * (`AnswerEvent`, `JudgeResult`) so the answer route, RAG orchestrator, eval harness, and
 * UI never import an SDK.
 *
 * Models (all local, all overridable by env):
 *   - generation:  llama3.2:3b        — streams the grounded answer
 *   - faithfulness: bespoke-minicheck — a purpose-built grounded-factuality checker,
 *                   run per claim ("is this supported by the context? yes/no")
 *   - relevance/citations: qwen2.5:7b — structured-JSON judge
 * Generation and judging use different models, so there is no self-preference bias.
 */

let client: Ollama | undefined;
export function ollama(): Ollama {
  // Lazy singleton so importing this module (e.g. during `next build`) never connects.
  client ??= new Ollama(process.env.OLLAMA_HOST ? { host: process.env.OLLAMA_HOST } : undefined);
  return client;
}

export const GEN_MODEL = process.env.RAG_MODEL ?? "llama3.2:3b";
export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "qwen2.5:7b"; // relevance + citations
export const FAITHFULNESS_MODEL = process.env.FAITHFULNESS_MODEL ?? "bespoke-minicheck"; // per-claim grounding

/** The minimal shape the generator/judge need for each cited passage. */
export interface AnswerContext {
  marker: number; // 1-based; the model cites this as [n]
  title: string;
  content: string;
}

// The sentence the model is asked to produce when the context can't answer.
export const REFUSAL_SENTENCE =
  "I don't have enough information in the indexed documents to answer that.";

// Small local models paraphrase, so match the refusal loosely rather than exactly.
export function looksLikeRefusal(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.startsWith("i don't have enough information") ||
    t.startsWith("i do not have enough information") ||
    t.includes("enough information in the indexed") ||
    t.includes("don't have enough information in the")
  );
}

const clamp01 = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

const GROUNDING_SYSTEM = `You are IndexFlow's answer assistant. Answer the user's question using ONLY the numbered context passages provided below — never outside knowledge.

Rules:
- Cite every factual claim with its passage number in square brackets, e.g. [1] or [2][3].
- Keep the answer concise: 1–4 sentences. Do not restate the question.
- If the passages do not contain enough information to answer, reply with exactly this sentence and nothing else: "${REFUSAL_SENTENCE}"
- Never invent facts, sources, or citations. If unsure, refuse using the sentence above.`;

export function renderContexts(contexts: AnswerContext[]): string {
  return contexts.map((c) => `[${c.marker}] Title: ${c.title}\n${c.content}`).join("\n\n");
}

function genMessages(question: string, contexts: AnswerContext[]) {
  return [
    { role: "system", content: GROUNDING_SYSTEM },
    { role: "user", content: `Context passages:\n\n${renderContexts(contexts)}\n\n---\nQuestion: ${question}` },
  ];
}

// ── Generation (provider-neutral event stream) ──────────────────────────────

export type AnswerEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      text: string;
      inputTokens: number | null;
      outputTokens: number | null;
      refused: boolean;
    };

/** Stream a grounded answer as text deltas, ending with a `done` event. */
export async function* streamAnswer(
  question: string,
  contexts: AnswerContext[],
): AsyncGenerator<AnswerEvent> {
  const span = tracer.startSpan("streamAnswer");
  span.setAttribute("model", GEN_MODEL);
  try {
    const res = await ollama().chat({
      model: GEN_MODEL,
      messages: genMessages(question, contexts),
      stream: true,
      options: { temperature: 0 },
    });
    let full = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    for await (const part of res) {
      const t = part.message?.content ?? "";
      if (t) {
        full += t;
        yield { type: "delta", text: t };
      }
      if (part.done) {
        inputTokens = part.prompt_eval_count ?? inputTokens;
        outputTokens = part.eval_count ?? outputTokens;
      }
    }
    span.setAttribute("inputTokens", inputTokens ?? 0);
    span.setAttribute("outputTokens", outputTokens ?? 0);
    yield { type: "done", text: full.trim(), inputTokens, outputTokens, refused: looksLikeRefusal(full) };
  } finally {
    span.end();
  }
}

/** Non-streaming generation for the eval harness. `keepAlive` controls model residency. */
export async function generateAnswer(
  question: string,
  contexts: AnswerContext[],
  keepAlive?: string | number,
): Promise<{ text: string; outputTokens: number | null; refused: boolean }> {
  return tracer.startActiveSpan("generateAnswer", async (span) => {
    span.setAttribute("model", GEN_MODEL);
    try {
      const res = await ollama().chat({
        model: GEN_MODEL,
        messages: genMessages(question, contexts),
        stream: false,
        keep_alive: keepAlive,
        options: { temperature: 0 },
      });
      const text = res.message.content.trim();
      span.setAttribute("outputTokens", res.eval_count ?? 0);
      return { text, outputTokens: res.eval_count ?? null, refused: looksLikeRefusal(text) };
    } finally {
      span.end();
    }
  });
}

/**
 * Free a model from memory (Ollama unloads on `keep_alive: 0`). The eval harness runs the
 * three models (generator, relevance judge, minicheck) in phases and unloads between them,
 * so only one is ever resident — essential on an 8 GB box where all three (~11 GB) can't
 * coexist without swap-thrashing a cold load past the client's fetch timeout.
 */
export async function unloadModel(model: string): Promise<void> {
  try {
    await ollama().generate({ model, prompt: "", keep_alive: 0 });
  } catch {
    // best-effort: if the unload call fails, the model just lingers until keep_alive expires
  }
}

/**
 * Load a model with a single, isolated request before batching work at it.
 *
 * Cold-loading a large model is slow (bespoke-minicheck: ~3min for its 5.5GB on an 8GB box)
 * and Node's fetch caps a response at 300s, so firing concurrent requests at a cold model
 * makes every one of them race the same load and time out together. Warming serialises that
 * cost into one call. A timed-out attempt is not fatal: the server keeps loading regardless,
 * so a retry lands on an already-resident model.
 */
export async function warmModel(model: string, keepAlive: string | number = "10m"): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ollama().generate({ model, prompt: "ok", keep_alive: keepAlive, options: { num_predict: 1 } });
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ── LLM-as-judge ────────────────────────────────────────────────────────────

export interface JudgeResult {
  faithfulness: number; // 0..1 fraction of answer claims supported by the context (minicheck)
  unsupported_claims: string[]; // claims minicheck marked unsupported
  answer_relevance: number; // 0..1 (qwen)
  citation_correctness: number; // 0..1 (qwen)
  refused: boolean;
  reasoning: string;
}

// Split an answer into atomic claims for per-claim grounding checks.
export function splitClaims(answer: string): string[] {
  return answer
    .replace(/\[\d+\]/g, " ") // strip citation markers
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

// bespoke-minicheck: "is this claim supported by the document?" → Yes/No.
export async function claimSupported(
  context: string,
  claim: string,
  keepAlive?: string | number,
): Promise<boolean> {
  const res = await ollama().chat({
    model: FAITHFULNESS_MODEL,
    messages: [{ role: "user", content: `Document: ${context}\n\nClaim: ${claim}` }],
    stream: false,
    keep_alive: keepAlive,
    options: { temperature: 0 },
  });
  return /^\s*yes/i.test(res.message.content);
}

// qwen scores relevance + citation correctness + refusal via constrained JSON.
const QWEN_JUDGE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    answer_relevance: { type: "number" },
    citation_correctness: { type: "number" },
    refused: { type: "boolean" },
  },
  required: ["reasoning", "answer_relevance", "citation_correctness", "refused"],
} as const;

const JUDGE_SYSTEM = `You are a strict, fair evaluator of retrieval-augmented answers. Judge ONLY against the provided context — never outside knowledge. Score answer_relevance (0..1, how directly the answer addresses the question) and citation_correctness (0..1, fraction of the answer's [n] citations whose passage actually supports the sentence; 1.0 if the answer correctly refuses). Set refused=true if the answer declined / said the context lacks the information. Return only the required JSON.`;

export async function relevanceJudge(
  question: string,
  contextText: string,
  answer: string,
  keepAlive?: string | number,
): Promise<{ answer_relevance: number; citation_correctness: number; refused: boolean; reasoning: string }> {
  const res = await ollama().chat({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      {
        role: "user",
        content: `Question:\n${question}\n\nContext passages the answer was allowed to use:\n\n${contextText}\n\n---\nAnswer to evaluate:\n${answer}\n\nReturn the JSON.`,
      },
    ],
    format: QWEN_JUDGE_SCHEMA,
    stream: false,
    keep_alive: keepAlive,
    // num_predict caps a runaway judge, it is not a tuning knob: observed verdicts run ~40 tokens
    // (reasoning 124-227 chars), so 96 leaves headroom and rarely binds. Note the failure mode if
    // it ever does — the constrained JSON is truncated mid-object and the parse below falls to the
    // catch, scoring the item 0. Raise it rather than trimming the schema if that starts happening.
    options: { temperature: 0, num_predict: 96 },
  });
  try {
    const j = JSON.parse(res.message.content) as Record<string, unknown>;
    return {
      answer_relevance: clamp01(j.answer_relevance),
      citation_correctness: clamp01(j.citation_correctness),
      refused: Boolean(j.refused),
      reasoning: String(j.reasoning ?? ""),
    };
  } catch {
    return { answer_relevance: 0, citation_correctness: 0, refused: false, reasoning: "judge returned unparseable output" };
  }
}

export async function judge(
  question: string,
  contexts: AnswerContext[],
  answer: string,
): Promise<JudgeResult> {
  const contextText = renderContexts(contexts);
  const rel = await relevanceJudge(question, contextText, answer);

  // A refusal is vacuously faithful (no claims to support) — don't run minicheck on it.
  if (rel.refused || looksLikeRefusal(answer)) {
    return { faithfulness: 1, unsupported_claims: [], ...rel, refused: true };
  }

  const claims = splitClaims(answer);
  if (claims.length === 0) {
    return { faithfulness: 1, unsupported_claims: [], ...rel };
  }
  const checks = await Promise.all(
    claims.map(async (c) => ({ claim: c, ok: await claimSupported(contextText, c) })),
  );
  const unsupported = checks.filter((x) => !x.ok).map((x) => x.claim);
  const faithfulness = (claims.length - unsupported.length) / claims.length;
  return { faithfulness, unsupported_claims: unsupported, ...rel };
}
