/**
 * Generation evaluation harness — the Stage B centerpiece.
 *
 * Extends the project's "measure it" thesis from retrieval into the LLM layer: for each
 * labeled question it runs the REAL retriever (same ephemeral-seed pattern as the
 * retrieval harness — no live-store dependency), generates a grounded answer with a local
 * model (llama3.2), and scores it with local judges — faithfulness per claim via
 * bespoke-minicheck, relevance + citations via qwen2.5. Unanswerable questions check the
 * refusal guardrail. Everything runs on Ollama: no API keys, no network.
 *
 * Generation and the judges are different models, so there is no self-preference bias.
 * Retrieval is local/deterministic; the LLM calls hit the local Ollama server. Note: with
 * a 3B generator the gate floors are targets — recalibrate them just under the first real
 * run's numbers (as the retrieval harness does) once you have a baseline.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral } from "../lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../lib/es";
import {
  generateAnswer,
  relevanceJudge,
  claimSupported,
  splitClaims,
  renderContexts,
  looksLikeRefusal,
  unloadModel,
  warmModel,
  GEN_MODEL,
  JUDGE_MODEL,
  FAITHFULNESS_MODEL,
  type AnswerContext,
  type JudgeResult,
} from "../lib/llm";
import corpus from "./corpus.json";
import answers from "./answers.json";

const RAG_K = 6; // contexts fed to the generator per question
// The eval runs the three models (generator, relevance judge, minicheck) in phases and
// unloads between them, so only ONE is resident at a time (see runRagEvaluation). Within a
// phase every request hits that one loaded model, so this parallelism costs no extra model
// memory — it only pipelines requests. Keep it modest on small boxes (KV-cache growth).
const PHASE_CONCURRENCY = 2;
// The judge is the 7B model, and two of its requests in flight double the KV cache. On an 8 GB
// box that tips into swap: measured 195 s/item at concurrency 2, versus 51 s/item at concurrency
// 1 on a 16 GB host. Serialising costs nothing real — the pipelining never paid for itself here.
const JUDGE_PHASE_CONCURRENCY = 1;

// Optional quick-run subset: EVAL_LIMIT=N caps the set (~2/3 answerable, 1/3 unanswerable)
// so you can sanity-check the whole pipeline without the full ~20-question run. Unset = full.
const EVAL_LIMIT = Number(process.env.EVAL_LIMIT ?? 0);
const evalSet =
  EVAL_LIMIT > 0
    ? [
        ...answers.filter((a) => a.answerable).slice(0, Math.ceil((EVAL_LIMIT * 2) / 3)),
        ...answers.filter((a) => !a.answerable).slice(0, Math.max(1, Math.floor(EVAL_LIMIT / 3))),
      ]
    : answers;
const CHECKPOINT_DIR = process.env.EVAL_RUN_DIR ?? new URL("../../../.evalrun", import.meta.url).pathname;
const CHECKPOINT = `${CHECKPOINT_DIR}/rag-work-${EVAL_LIMIT > 0 ? EVAL_LIMIT : "full"}.json`;
const CHECKPOINT_SIGNATURE = JSON.stringify({
  evalLimit: EVAL_LIMIT,
  questions: evalSet.map((a) => a.q),
  genModel: GEN_MODEL,
  judgeModel: JUDGE_MODEL,
  faithfulnessModel: FAITHFULNESS_MODEL,
});

export interface RagGateRow {
  name: string;
  value: number;
  floor: number;
  pass: boolean;
}
export interface RagItem {
  q: string;
  answerable: boolean;
  answer: string;
  contextRecall: boolean | null; // answerable only: did retrieval surface a gold chunk?
  judge: JudgeResult;
  error?: boolean; // set when gen/judge failed for this item (isolated, not fatal)
  /** Atomic claims minicheck graded. Needed to audit the judge per claim, not just per answer. */
  claims?: string[];
  /** The passages the judge saw. A human auditing a verdict needs exactly the same evidence. */
  contextText?: string;
}
export interface RagReport {
  numAnswerable: number;
  numUnanswerable: number;
  ragK: number;
  genModel: string;
  judgeModel: string;
  faithfulness: number; // mean over answerable
  answerRelevance: number; // mean over answerable
  citationCorrectness: number; // mean over answerable
  contextRecall: number; // fraction of answerable where a gold chunk was retrieved
  refusalCorrectness: number; // fraction of unanswerable correctly refused
  items: RagItem[];
  gate: RagGateRow[];
  passed: boolean;
  selfJudged: boolean; // true when gen and judge use the same model (see caveat)
}

class Rollback extends Error {}

interface Prepared {
  q: string;
  answerable: boolean;
  contexts: AnswerContext[];
  contextRecall: boolean | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Seed the labeled corpus into ephemeral stores and, for each question, return the top-k
 * hybrid contexts — the exact retrieval the answer path uses. LLM calls happen AFTER this
 * (never inside the rolled-back transaction).
 */
async function prepareContexts(): Promise<Prepared[]> {
  const idByFile = new Map<string, string>();
  for (const doc of corpus) idByFile.set(doc.fileName, randomUUID());
  const titleByFile = new Map(corpus.map((d) => [d.fileName, d.title]));

  const chunks: { fileName: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  for (const doc of corpus) {
    for (const c of chunkText(doc.content)) {
      chunks.push({ fileName: doc.fileName, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }
  const chunkById = new Map(chunks.map((c) => [c.chunkId, c]));

  const chunkVecs = await embed(chunks.map((c) => c.content));
  const queryVecs = await embed(evalSet.map((a) => a.q));

  const toScored = (h: { chunkId: string; score: number }[]): Scored[] =>
    h.map((x) => ({ id: x.chunkId, score: x.score }));

  const prepared: Prepared[] = [];
  const esIndex = await createEphemeralIndex();
  try {
    const esChunks: EsChunk[] = chunks.map((c) => ({
      chunkId: c.chunkId,
      documentId: idByFile.get(c.fileName)!,
      chunkIndex: c.index,
      title: titleByFile.get(c.fileName) ?? c.fileName,
      fileType: "md",
      content: c.content,
    }));
    await indexChunks(esChunks, esIndex, "wait_for");

    // Keyword candidates: real BM25 against the ephemeral index.
    const kwByQuery: { chunkId: string; score: number }[][] = [];
    for (const a of evalSet) {
      const hits = await keywordSearch(a.q, null, chunks.length, esIndex);
      kwByQuery.push(hits.map((h) => ({ chunkId: h.chunkId, score: h.score })));
    }

    // Semantic candidates: exact pgvector KNN inside a rolled-back transaction.
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
          await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

          for (const doc of corpus) {
            await tx.$executeRaw`
              INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
              VALUES (${idByFile.get(doc.fileName)}::uuid, ${doc.title}, ${doc.fileName}, 'md', 'INDEXED', now(), now())
            `;
          }
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            await tx.$executeRaw`
              INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
              VALUES (${c.chunkId}::uuid, ${idByFile.get(c.fileName)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i])}::vector, now())
            `;
          }
          const corpusIds = [...idByFile.values()];

          for (let i = 0; i < evalSet.length; i++) {
            const a = evalSet[i];
            const vec = toVectorLiteral(queryVecs[i]);
            const sm = await tx.$queryRaw<{ chunkId: string; score: number }[]>`
              SELECT dc.id::text AS "chunkId", 1 - (dc.embedding <=> ${vec}::vector) AS score
              FROM document_chunks dc
              WHERE dc."documentId"::text = ANY(${corpusIds}) AND dc.embedding IS NOT NULL
              ORDER BY dc.embedding <=> ${vec}::vector
              LIMIT 30
            `;

            const blended = blendHybrid(toScored(kwByQuery[i]), toScored(sm), DEFAULT_HYBRID_WEIGHT);
            const topIds = blended.slice(0, RAG_K).map((b) => b.id);
            const contexts: AnswerContext[] = topIds.map((id, j) => {
              const c = chunkById.get(id)!;
              return { marker: j + 1, title: titleByFile.get(c.fileName) ?? c.fileName, content: c.content };
            });

            const relevantDocIds = a.relevant.map((f) => idByFile.get(f)).filter(Boolean) as string[];
            const retrievedDocIds = new Set(topIds.map((id) => idByFile.get(chunkById.get(id)!.fileName)!));
            const contextRecall = a.answerable
              ? relevantDocIds.some((d) => retrievedDocIds.has(d))
              : null;

            prepared.push({ q: a.q, answerable: a.answerable, contexts, contextRecall });
          }
          throw new Rollback();
        },
        { timeout: 60_000, maxWait: 15_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }
  return prepared;
}

// Per-item working state, filled in across the three model phases.
interface Work {
  p: Prepared;
  contextText: string;
  answer: string;
  rel: { answer_relevance: number; citation_correctness: number; refused: boolean; reasoning: string };
  claims: string[]; // claims to grounding-check (empty when refused)
  unsupported: string[];
  error?: string;
}

function saveCheckpoint(stage: string, work: Work[]): void {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  writeFileSync(
    CHECKPOINT,
    JSON.stringify({ savedAt: new Date().toISOString(), stage, signature: CHECKPOINT_SIGNATURE, work }, null, 2),
  );
}

function loadCheckpoint(): Work[] | null {
  if (!existsSync(CHECKPOINT)) return null;
  const raw = JSON.parse(readFileSync(CHECKPOINT, "utf8")) as { signature?: string; stage?: string; work?: Work[] };
  if (raw.signature !== CHECKPOINT_SIGNATURE || !Array.isArray(raw.work)) return null;
  phase(`resuming checkpoint ${CHECKPOINT}${raw.stage ? ` (${raw.stage})` : ""}`);
  return raw.work;
}

const KEEP = "10m"; // hold the current phase's model resident across all its items

// The run takes tens of minutes (cold model loads dominate), so report progress rather than
// sitting silent — a silent failure here is indistinguishable from a slow one.
const t0 = Date.now();
const phase = (msg: string) =>
  console.log(`[rag-eval +${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${msg}`);

export async function runRagEvaluation(): Promise<RagReport> {
  // The eval is run in phases by model so only one large model is resident at a time. On an
  // 8 GB box the three models (~11 GB total) cannot coexist: interleaving gen→judge→minicheck
  // per item swap-thrashes a cold load past the fetch timeout. Phasing loads each model once.
  let work = loadCheckpoint();
  if (!work) {
    phase("preparing contexts (seed + retrieve)…");
    const prepared = await prepareContexts();
    phase(`contexts ready for ${prepared.length} questions`);
    work = prepared.map((p) => ({
      p,
      contextText: renderContexts(p.contexts),
      answer: "",
      rel: { answer_relevance: 0, citation_correctness: 0, refused: false, reasoning: "" },
      claims: [],
      unsupported: [],
    }));
    saveCheckpoint("contexts", work);
  }

  // ── Phase 1: generation (only GEN_MODEL resident) ──
  const toGenerate = work.filter((w) => !w.error && !w.answer);
  phase(`phase 1/3: generating ${toGenerate.length}/${work.length} answers with ${GEN_MODEL} (loading model…)`);
  // Resuming a checkpoint past phase 1 leaves nothing to generate: skip the load entirely so a
  // resume never pays for a model it will not call (phase 3 guards itself the same way).
  if (toGenerate.length) await warmModel(GEN_MODEL, KEEP);
  let done = work.length - toGenerate.length;
  await mapLimit(toGenerate, PHASE_CONCURRENCY, async (w) => {
    try {
      const { text } = await generateAnswer(w.p.q, w.p.contexts, KEEP);
      w.answer = text;
    } catch (e) {
      w.error = `generation: ${e instanceof Error ? e.message : "failed"}`;
    }
    phase(`  generated ${++done}/${work.length}`);
    saveCheckpoint("generation", work);
  });
  if (toGenerate.length) await unloadModel(GEN_MODEL);

  // ── Phase 2: relevance + citation judge (only JUDGE_MODEL resident) ──
  const toJudge = work.filter((w) => !w.error && w.answer && w.rel.reasoning === "");
  phase(`phase 2/3: judging ${toJudge.length}/${work.length} relevance + citation rows with ${JUDGE_MODEL} (loading model…)`);
  if (toJudge.length) await warmModel(JUDGE_MODEL, KEEP);
  done = work.length - toJudge.length;
  await mapLimit(toJudge, JUDGE_PHASE_CONCURRENCY, async (w) => {
    try {
      w.rel = await relevanceJudge(w.p.q, w.contextText, w.answer, KEEP);
    } catch (e) {
      w.error = `judge: ${e instanceof Error ? e.message : "failed"}`;
    }
    phase(`  judged ${++done}/${work.length}`);
    saveCheckpoint("relevance", work);
  });
  if (toJudge.length) await unloadModel(JUDGE_MODEL);

  // Decide which answers need per-claim grounding: a refusal is vacuously faithful.
  for (const w of work) {
    if (w.error) continue;
    if (w.rel.refused || looksLikeRefusal(w.answer)) {
      w.rel.refused = true;
      w.claims = [];
    } else {
      w.claims = splitClaims(w.answer);
    }
  }

  // ── Phase 3: faithfulness per claim (only FAITHFULNESS_MODEL resident) ──
  // Strictly sequential: minicheck is the largest model, and parallel requests at it are what
  // originally raced its cold load into a fetch timeout. Warmed once, each check is quick.
  const toCheck = work.filter((w) => !w.error && w.claims.length > 0);
  const totalClaims = toCheck.reduce((n, w) => n + w.claims.length, 0);
  phase(`phase 3/3: grounding ${totalClaims} claims with ${FAITHFULNESS_MODEL} (loading model, ~3min…)`);
  if (toCheck.length) await warmModel(FAITHFULNESS_MODEL, KEEP);
  let checked = 0;
  for (const w of toCheck) {
    try {
      for (const c of w.claims) {
        const ok = await claimSupported(w.contextText, c, KEEP);
        if (!ok) w.unsupported.push(c);
        phase(`  checked claim ${++checked}/${totalClaims}`);
        saveCheckpoint("faithfulness", work);
      }
    } catch (e) {
      w.error = `minicheck: ${e instanceof Error ? e.message : "failed"}`;
    }
  }
  await unloadModel(FAITHFULNESS_MODEL);
  phase("done");

  // ── Assemble per-item results ──
  const items: RagItem[] = work.map((w): RagItem => {
    if (w.error) {
      return {
        q: w.p.q,
        answerable: w.p.answerable,
        answer: w.answer,
        contextRecall: w.p.contextRecall,
        error: true,
        judge: {
          faithfulness: 0,
          unsupported_claims: [],
          answer_relevance: 0,
          citation_correctness: 0,
          refused: false,
          reasoning: `error: ${w.error}`,
        },
      };
    }
    const refused = w.rel.refused;
    const faithfulness = refused || w.claims.length === 0
      ? 1
      : (w.claims.length - w.unsupported.length) / w.claims.length;
    const judged: JudgeResult = {
      faithfulness,
      unsupported_claims: w.unsupported,
      answer_relevance: w.rel.answer_relevance,
      citation_correctness: w.rel.citation_correctness,
      refused,
      reasoning: w.rel.reasoning,
    };
    return {
      q: w.p.q,
      answerable: w.p.answerable,
      answer: w.answer,
      contextRecall: w.p.contextRecall,
      judge: judged,
      claims: w.claims,
      contextText: w.contextText,
    };
  });

  const answerable = items.filter((i) => i.answerable);
  const unanswerable = items.filter((i) => !i.answerable);

  const faithfulness = mean(answerable.map((i) => i.judge.faithfulness));
  const answerRelevance = mean(answerable.map((i) => i.judge.answer_relevance));
  const citationCorrectness = mean(answerable.map((i) => i.judge.citation_correctness));
  const contextRecall = mean(answerable.map((i) => (i.contextRecall ? 1 : 0)));
  const refusalCorrectness = mean(unanswerable.map((i) => (i.judge.refused ? 1 : 0)));

  const g = (name: string, value: number, floor: number): RagGateRow => ({ name, value, floor, pass: value >= floor });
  // Floors sit just under the observed baseline (faith 0.98, relevance/citation/recall 1.0,
  // refusal 0.92 on the 32-question set — see README), with a cushion so ordinary 3B-model
  // run-to-run variance passes while a real regression (a new hallucination or a dropped
  // refusal) trips the gate. Re-tighten after swapping the generator/judge models.
  const gate: RagGateRow[] = [
    g("faithfulness (answerable)", faithfulness, 0.92),
    g("citation correctness (answerable)", citationCorrectness, 0.9),
    g("answer relevance (answerable)", answerRelevance, 0.92),
    g("refusal correctness (unanswerable)", refusalCorrectness, 0.85),
    g("context recall (answerable)", contextRecall, 0.9),
  ];

  return {
    numAnswerable: answerable.length,
    numUnanswerable: unanswerable.length,
    ragK: RAG_K,
    genModel: GEN_MODEL,
    judgeModel: `${FAITHFULNESS_MODEL} + ${JUDGE_MODEL}`,
    faithfulness,
    answerRelevance,
    citationCorrectness,
    contextRecall,
    refusalCorrectness,
    items,
    gate,
    passed: gate.every((r) => r.pass),
    // Generation (llama3.2) differs from both judges (minicheck, qwen), so no self-bias.
    selfJudged: false,
  };
}
