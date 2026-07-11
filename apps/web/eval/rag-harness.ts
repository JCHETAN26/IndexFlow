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
import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/chunk";
import { embed, toVectorLiteral } from "../lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT, type Scored } from "../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../lib/es";
import {
  generateAnswer,
  judge,
  GEN_MODEL,
  JUDGE_MODEL,
  FAITHFULNESS_MODEL,
  type AnswerContext,
  type JudgeResult,
} from "../lib/llm";
import corpus from "./corpus.json";
import answers from "./answers.json";

const RAG_K = 6; // contexts fed to the generator per question
// Bounded parallelism: each item cycles gen → relevance-judge → minicheck across three
// local models, so high concurrency just thrashes Ollama's model cache. Tune via memory.
const CONCURRENCY = 3;

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
  const queryVecs = await embed(answers.map((a) => a.q));

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
    for (const a of answers) {
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

          for (let i = 0; i < answers.length; i++) {
            const a = answers[i];
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

export async function runRagEvaluation(): Promise<RagReport> {
  const prepared = await prepareContexts();

  const items = await mapLimit(prepared, CONCURRENCY, async (p): Promise<RagItem> => {
    try {
      const { text } = await generateAnswer(p.q, p.contexts);
      const judged = await judge(p.q, p.contexts, text);
      return { q: p.q, answerable: p.answerable, answer: text, contextRecall: p.contextRecall, judge: judged };
    } catch (e) {
      // Isolate per-item failures so one bad call doesn't discard the whole (slow) run.
      return {
        q: p.q,
        answerable: p.answerable,
        answer: "",
        contextRecall: p.contextRecall,
        error: true,
        judge: {
          faithfulness: 0,
          unsupported_claims: [],
          answer_relevance: 0,
          citation_correctness: 0,
          refused: false,
          reasoning: `error: ${e instanceof Error ? e.message : "failed"}`,
        },
      };
    }
  });

  const answerable = items.filter((i) => i.answerable);
  const unanswerable = items.filter((i) => !i.answerable);

  const faithfulness = mean(answerable.map((i) => i.judge.faithfulness));
  const answerRelevance = mean(answerable.map((i) => i.judge.answer_relevance));
  const citationCorrectness = mean(answerable.map((i) => i.judge.citation_correctness));
  const contextRecall = mean(answerable.map((i) => (i.contextRecall ? 1 : 0)));
  const refusalCorrectness = mean(unanswerable.map((i) => (i.judge.refused ? 1 : 0)));

  const g = (name: string, value: number, floor: number): RagGateRow => ({ name, value, floor, pass: value >= floor });
  const gate: RagGateRow[] = [
    g("faithfulness (answerable)", faithfulness, 0.9),
    g("citation correctness (answerable)", citationCorrectness, 0.85),
    g("answer relevance (answerable)", answerRelevance, 0.9),
    g("refusal correctness (unanswerable)", refusalCorrectness, 0.9),
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
