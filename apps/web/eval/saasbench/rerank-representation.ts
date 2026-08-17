/**
 * Phase 2b — document representation for the cross-encoder (R1 / R2 / R3).
 *
 * The depth sweep reranks ONE chunk per candidate document: the chunk the first-stage retriever
 * scored highest. That is an efficiency variant, and it is **not** equivalent to reranking a
 * document's full retrieved evidence — BM25 and cosine choose that representative chunk, and the
 * cross-encoder may judge a different chunk of the same document more relevant. Treating the two as
 * the same thing would silently attribute a representation limit to the reranker.
 *
 * So this measures the representation directly:
 *
 *   R1  top 1 candidate chunk per document        document score = reranker score
 *   R2  top 2 candidate chunks per document        document score = max reranker score
 *   R3  top 3 candidate chunks per document        document score = max reranker score
 *
 * R1 reproduces the sweep's behaviour and acts as the control. Chunks come from the candidate pool
 * only, never from the document at large, so this stays a reranking experiment rather than a
 * retrieval one. At ~2.25 chunks per document R3 is close to "all retrieved evidence".
 *
 * Selection rule, fixed in advance: take the SMALLEST representation whose quality is statistically
 * indistinguishable from the best. More pairs per query is more latency, and buying an
 * indistinguishable score with it is not an improvement.
 *
 * TUNE SPLIT ONLY.
 *
 *   SWEEP_BEST_DEPTH=50 pnpm --filter @indexflow/web saasbench:rerank-repr
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { chunkText } from "../../lib/chunk";
import { embed, toVectorLiteral } from "../../lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT } from "../../lib/hybrid";
import { rerank, RERANK_MODEL } from "../../lib/rerank";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../../lib/es";
import { ndcgAtGraded, ranksFromRanked, mrr, recallAt, bootstrapDelta } from "../metrics";
import { checkStructure } from "./structural";
import type { SaasQuery } from "./queries";
import type { SaasDoc } from "./documents";

const BEST_DEPTH = Number(process.env.SWEEP_BEST_DEPTH ?? 50);
const REPRESENTATIONS = (process.env.SWEEP_REPR ?? "1,2,3").split(",").map(Number);
const MAX_TUNE = Number(process.env.SWEEP_MAX_TUNE ?? 0);
const INSERT_BATCH = 500;

class Rollback extends Error {}
const f3 = (n: number) => n.toFixed(3);
const pc = (n: number) => `${(n * 100).toFixed(1)}%`;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

interface Hit { chunkId: string; docId: string; score: number; content: string }
interface Row { query: SaasQuery; kw: Hit[]; sm: Hit[] }
interface Metrics { ndcg10: number; mrr10: number; r5: number; r10: number; success1: number; n: number; perQuery: number[] }

function scoreRankings(rankings: string[][], queries: SaasQuery[]): Metrics {
  const keep = queries.map((q, i) => ({ q, ranked: rankings[i] })).filter((r) => Object.keys(r.q.qrels).length > 0);
  const graded = keep.map((r) => ({ relevant: new Map(Object.entries(r.q.qrels)) }));
  const ranked = keep.map((r) => r.ranked);
  const binary = keep.map((r) => ({ relevant: Object.keys(r.q.qrels) }));
  const ranks = keep.map((r) => ranksFromRanked(r.ranked, new Map(Object.entries(r.q.qrels))));
  return {
    ndcg10: ndcgAtGraded(ranked, graded, 10),
    mrr10: mrr(ranks, binary),
    r5: recallAt(ranks, binary, 5),
    r10: recallAt(ranks, binary, 10),
    success1: keep.length ? keep.filter((r) => r.ranked.length && (r.q.qrels[r.ranked[0]] ?? 0) > 0).length / keep.length : 0,
    n: keep.length,
    perQuery: keep.map((r, i) => ndcgAtGraded([ranked[i]], [graded[i]], 10)),
  };
}

function oracleOf(docs: string[], qrels: Record<string, number>): { ndcg10: number; mrr10: number } {
  const graded = docs.map((d) => ({ id: d, g: qrels[d] ?? 0 })).sort((a, b) => b.g - a.g).map((x) => x.id);
  const relevant = new Map(Object.entries(qrels));
  return {
    ndcg10: ndcgAtGraded([graded], [{ relevant }], 10),
    mrr10: mrr([ranksFromRanked(graded, relevant)], [{ relevant: Object.keys(qrels) }]),
  };
}

/** Best-scoring chunk per document — the passage the cross-encoder judges the document by. */
function bestChunkPerDoc(hits: Hit[]): Map<string, Hit> {
  const best = new Map<string, Hit>();
  for (const h of hits) {
    const cur = best.get(h.docId);
    if (!cur || h.score > cur.score) best.set(h.docId, h);
  }
  return best;
}

async function main() {
  const t0 = Date.now();
  const el = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
  const snapName = process.env.SAASBENCH_SNAPSHOT ?? "d3400-s42";
  const dir = join(process.cwd(), "eval", "saasbench", "snapshots", snapName);

  const documents: SaasDoc[] = (await readFile(join(dir, "documents.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const queries: SaasQuery[] = JSON.parse(await readFile(join(dir, "queries.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const scenarios = JSON.parse(await readFile(join(dir, "scenarios.json"), "utf8"));
  const svcOf = new Map<string, string>(scenarios.map((s: any) => [s.id, s.service]));

  if (checkStructure(scenarios, documents, queries).length > 0) {
    console.error("[rerank-sweep] structural rules violated; refusing to run.");
    process.exit(1);
  }

  const judged = queries.filter((q) => Object.keys(q.qrels).length > 0);
  let tune = judged.filter((q) => q.split === "tune");
  if (MAX_TUNE > 0) tune = tune.slice(0, MAX_TUNE);
  const maxDepth = BEST_DEPTH;

  console.log(`\n[rerank-sweep] ${snapName} · generator ${manifest.generatorVersion}`);
  console.log(`  corpus ${manifest.corpusHash.slice(0, 12)} · queries ${manifest.queriesHash.slice(0, 12)}`);
  console.log(`  TUNE split only: ${tune.length} judged queries · depth ${BEST_DEPTH} · representations R${REPRESENTATIONS.join(", R")} · reranker ${RERANK_MODEL}`);

  const chunks: { docId: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  for (const d of documents) {
    for (const c of chunkText(`${d.title}\n\n${d.body}`)) {
      chunks.push({ docId: d.id, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }
  console.log(`${el()} ${chunks.length} chunks`);
  console.log(`${el()} embedding chunks...`);
  const chunkVecs: number[][] = [];
  for (let i = 0; i < chunks.length; i += 2000) {
    chunkVecs.push(...(await embed(chunks.slice(i, i + 2000).map((c) => c.content))));
    console.log(`${el()}   ${Math.min(i + 2000, chunks.length)}/${chunks.length}`);
  }

  // Ablation query forms, built once. FULL is the real query; ANCHOR-ONLY is the service name
  // alone; ANCHOR-MASKED replaces it with a placeholder.
  const ablationClasses = new Set(["paraphrase", "troubleshooting", "version", "multi-document"]);
  const ablate = tune.filter((q) => ablationClasses.has(q.queryClass) && q.targetScenarioId);
  const formText = (q: SaasQuery, form: "full" | "anchor-only" | "anchor-masked") => {
    const svc = q.targetScenarioId ? svcOf.get(q.targetScenarioId) : undefined;
    if (form === "full" || !svc) return q.text;
    return form === "anchor-only" ? svc : q.text.replaceAll(svc, "[SERVICE]");
  };

  console.log(`${el()} embedding queries (tune + ablation forms)...`);
  const tuneVecs = await embed(tune.map((q) => q.text));
  const ablVecs: Record<string, number[][]> = {
    "anchor-only": await embed(ablate.map((q) => formText(q, "anchor-only"))),
    "anchor-masked": await embed(ablate.map((q) => formText(q, "anchor-masked"))),
  };

  const uuidByDoc = new Map(documents.map((d) => [d.id, randomUUID() as string]));
  const docByUuid = new Map([...uuidByDoc].map(([id, uuid]) => [uuid, id]));
  const contentByChunk = new Map(chunks.map((c) => [c.chunkId, c.content]));

  const esIndex = await createEphemeralIndex("saasbench_repr");
  const rows: Row[] = [];
  const ablResults: Record<string, Record<string, Metrics>> = { keyword: {}, semantic: {} };
  try {
    console.log(`${el()} indexing into Elasticsearch...`);
    const esChunks: EsChunk[] = chunks.map((c) => ({
      chunkId: c.chunkId, documentId: uuidByDoc.get(c.docId)!, chunkIndex: c.index,
      title: "", fileType: "md", content: c.content,
    }));
    for (let i = 0; i < esChunks.length; i += 2000) {
      await indexChunks(esChunks.slice(i, i + 2000), esIndex, i + 2000 >= esChunks.length ? "wait_for" : false);
    }

    console.log(`${el()} keyword retrieval (depth ${maxDepth})...`);
    const kwByQuery: Hit[][] = [];
    for (const q of tune) {
      const hits = await keywordSearch(q.text, null, maxDepth, esIndex);
      kwByQuery.push(hits.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.documentId)!, score: h.score, content: contentByChunk.get(h.chunkId) ?? "" })));
    }

    // Keyword-leg ablation.
    for (const form of ["full", "anchor-only", "anchor-masked"] as const) {
      const rk: string[][] = [];
      for (const q of ablate) {
        const hits = await keywordSearch(formText(q, form), null, 50, esIndex);
        const seen = new Set<string>(); const out: string[] = [];
        for (const h of hits) { const d = docByUuid.get(h.documentId)!; if (!seen.has(d)) { seen.add(d); out.push(d); } }
        rk.push(out);
      }
      ablResults.keyword[form] = scoreRankings(rk, ablate);
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
        console.log(`${el()} seeding...`);
        for (let i = 0; i < documents.length; i += INSERT_BATCH) {
          const b = documents.slice(i, i + INSERT_BATCH);
          await tx.$executeRaw`INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
            VALUES ${Prisma.join(b.map((d) => Prisma.sql`(${uuidByDoc.get(d.id)}::uuid, ${d.title}, ${`${d.id}.${d.fileType}`}, ${d.fileType}, 'INDEXED', now(), now())`))}`;
        }
        for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
          const b = chunks.slice(i, i + INSERT_BATCH);
          await tx.$executeRaw`INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
            VALUES ${Prisma.join(b.map((c, j) => Prisma.sql`(${c.chunkId}::uuid, ${uuidByDoc.get(c.docId)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i + j])}::vector, now())`))}`;
        }

        const knn = async (vec: number[], k: number) => {
          const v = toVectorLiteral(vec);
          return tx.$queryRaw<{ chunkId: string; docUuid: string; score: number }[]>`
            SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docUuid",
                   1 - (dc.embedding <=> ${v}::vector) AS score
            FROM document_chunks dc WHERE dc.embedding IS NOT NULL
            ORDER BY dc.embedding <=> ${v}::vector LIMIT ${k}`;
        };

        console.log(`${el()} semantic retrieval (depth ${maxDepth})...`);
        for (let i = 0; i < tune.length; i++) {
          const sm = await knn(tuneVecs[i], maxDepth);
          rows.push({
            query: tune[i], kw: kwByQuery[i],
            sm: sm.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.docUuid)!, score: Number(h.score), content: contentByChunk.get(h.chunkId) ?? "" })),
          });
        }

        console.log(`${el()} dense-leg ablation...`);
        for (const form of ["full", "anchor-only", "anchor-masked"] as const) {
          const rk: string[][] = [];
          for (let i = 0; i < ablate.length; i++) {
            const vec = form === "full" ? tuneVecs[tune.indexOf(ablate[i])] : ablVecs[form][i];
            const sm = await knn(vec, 50);
            const seen = new Set<string>(); const out: string[] = [];
            for (const h of sm) { const d = docByUuid.get(h.docUuid)!; if (!seen.has(d)) { seen.add(d); out.push(d); } }
            rk.push(out);
          }
          ablResults.semantic[form] = scoreRankings(rk, ablate);
        }
        throw new Rollback();
      }, { timeout: 3 * 60 * 60_000, maxWait: 120_000 });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }

  // ── Phase 1 item 6: ablation on BOTH legs ───────────────────────────────
  console.log(`\n${el()} ── anchor ablation, both legs (tune, natural-language classes, n=${ablate.length}) ──\n`);
  console.log("    leg        form            nDCG@10   MRR@10   vs full");
  for (const leg of ["keyword", "semantic"] as const) {
    const full = ablResults[leg].full;
    for (const form of ["full", "anchor-only", "anchor-masked"] as const) {
      const m = ablResults[leg][form];
      const ratio = form === "full" ? "" : pc(m.ndcg10 / Math.max(full.ndcg10, 1e-9));
      console.log(`    ${leg.padEnd(10)} ${form.padEnd(15)} ${f3(m.ndcg10)}    ${f3(m.mrr10)}   ${ratio}`);
    }
  }

  // ── Phase 2: union → cross-encoder depth sweep ──────────────────────────
  const W = DEFAULT_HYBRID_WEIGHT;
  const qs = rows.map((r) => r.query);
  const baseline = scoreRankings(
    rows.map((r) => {
      const blended = blendHybrid(r.kw.map((h) => ({ id: h.chunkId, score: h.score })), r.sm.map((h) => ({ id: h.chunkId, score: h.score })), W);
      const byChunk = new Map([...r.kw, ...r.sm].map((h) => [h.chunkId, h.docId]));
      const seen = new Set<string>(); const out: string[] = [];
      for (const b of blended) { const d = byChunk.get(b.id)!; if (d && !seen.has(d)) { seen.add(d); out.push(d); } }
      return out;
    }), qs);

  console.log(`\n${el()} ── Phase 2b · representation sweep at depth ${BEST_DEPTH} (TUNE, n=${baseline.n}) ──\n`);
  console.log(`    shipping hybrid baseline: nDCG@10 ${f3(baseline.ndcg10)} · MRR@10 ${f3(baseline.mrr10)}\n`);
  console.log("    repr   pairs/q   nDCG@10   MRR@10   S@1      R@10    rr p50   rr p95");

  /** The document's top-N chunks from the candidate pool, by first-stage score. */
  const topChunksPerDoc = (hits: Hit[], n: number): Map<string, Hit[]> => {
    const byDoc = new Map<string, Hit[]>();
    for (const h of hits) {
      const list = byDoc.get(h.docId);
      if (list) list.push(h);
      else byDoc.set(h.docId, [h]);
    }
    for (const [k, v] of byDoc) byDoc.set(k, v.sort((a, b) => b.score - a.score).slice(0, n));
    return byDoc;
  };

  const results: Record<number, any> = {};
  let control: Metrics | null = null;
  for (const n of REPRESENTATIONS) {
    const rankings: string[][] = [];
    const pairCounts: number[] = [];
    const latencies: number[] = [];
    for (const r of rows) {
      const kwTop = topChunksPerDoc(r.kw.slice(0, BEST_DEPTH), n);
      const smTop = topChunksPerDoc(r.sm.slice(0, BEST_DEPTH), n);
      // Union at document level, keeping each document's best n chunks from either leg.
      const byDoc = new Map<string, Hit[]>();
      for (const [docId, hits] of [...kwTop, ...smTop]) {
        const merged = [...(byDoc.get(docId) ?? []), ...hits];
        const seen = new Set<string>();
        byDoc.set(docId, merged.filter((h) => !seen.has(h.chunkId) && seen.add(h.chunkId))
          .sort((a, b) => b.score - a.score).slice(0, n));
      }
      const cands = [...byDoc.values()].flat().map((h) => ({
        chunkId: h.chunkId, documentId: h.docId, title: "", fileType: "md", snippet: "", score: h.score, content: h.content,
      }));
      pairCounts.push(cands.length);
      const t = performance.now();
      const reranked = await rerank(r.query.text, cands as any);
      latencies.push(performance.now() - t);
      // Document score is the MAX reranker score across its chunks; `rerank` returns descending, so
      // first occurrence of a document already is its maximum.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const c of reranked) if (!seen.has(c.documentId)) { seen.add(c.documentId); out.push(c.documentId); }
      rankings.push(out);
    }
    const m = scoreRankings(rankings, qs);
    control ??= m;
    const delta = bootstrapDelta(m.perQuery, control.perQuery);
    const meanPairs = pairCounts.reduce((a, b) => a + b, 0) / pairCounts.length;
    results[n] = { metrics: m, meanPairs, rrP50: quantile(latencies, 0.5), rrP95: quantile(latencies, 0.95), deltaVsR1: delta };
    console.log(
      `    R${n}    ${meanPairs.toFixed(0).padStart(7)}   ${f3(m.ndcg10)}    ${f3(m.mrr10)}   ${pc(m.success1).padStart(6)} ${pc(m.r10).padStart(6)}   ` +
      `${quantile(latencies, 0.5).toFixed(0).padStart(6)}   ${quantile(latencies, 0.95).toFixed(0).padStart(6)}`);
    if (n !== REPRESENTATIONS[0]) {
      console.log(`           Δ nDCG@10 vs R${REPRESENTATIONS[0]} ${f3(delta.value)} [${f3(delta.lo)}, ${f3(delta.hi)}] ${delta.excludesZero ? "excludes zero" : "includes zero"}`);
    }
  }

  const outDir = join(process.cwd(), "eval", "saasbench", "results");
  await mkdir(outDir, { recursive: true });
  const env = {
    snapshot: snapName, generatorVersion: manifest.generatorVersion,
    corpusHash: manifest.corpusHash, queriesHash: manifest.queriesHash, qrelsHash: manifest.qrelsHash,
    gitSha: process.env.GIT_SHA ?? null, split: "tune", tuneQueries: tune.length,
    embeddingModel: "Xenova/all-MiniLM-L6-v2", rerankerModel: RERANK_MODEL, hybridWeight: W, bestDepth: BEST_DEPTH, representations: REPRESENTATIONS,
  };
  await writeFile(join(outDir, "rerank-representation.json"), JSON.stringify({ env, bestDepth: BEST_DEPTH, baseline, representations: results }, null, 2));
  console.log(`\n${el()} artifacts -> ${outDir}\n`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
