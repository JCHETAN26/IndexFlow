/**
 * SaaSBench retrieval diagnostics — Phase 4, Tasks A/B/C/D/F/G.
 *
 * Answers one question: **when IndexFlow gets a query wrong, did it fail to retrieve the document
 * or fail to rank it?** Those have opposite remedies, and every optimisation worth doing next
 * depends on knowing which one applies.
 *
 * Everything runs off ONE indexing pass. Candidates are collected deep (per leg) and every
 * diagnostic is computed from the stored lists, so recall curves, oracle ceilings, chunk-collapse
 * statistics, both fusion variants and the aggregation experiment cost one embedding run between
 * them rather than six.
 *
 * Discipline, per the phase brief:
 *   - the shipping baseline is measured with the LEGACY fusion, defect included
 *   - the aggregation experiment reports the TUNE split only
 *   - oracle numbers are diagnostic ceilings and are labelled NOT DEPLOYABLE everywhere they appear
 *   - nothing here modifies production retrieval
 *
 *   pnpm --filter @indexflow/web saasbench:diagnose
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { chunkText } from "../../lib/chunk";
import { embed, toVectorLiteral } from "../../lib/embed";
import { DEFAULT_HYBRID_WEIGHT } from "../../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../../lib/es";
import { ndcgAtGraded, ranksFromRanked, mrr, recallAt, bootstrapDelta } from "../metrics";
import { legacyMinMax, correctedMinMax, type Scored } from "./fusion";
import { checkStructure, anchorSummary } from "./structural";
import type { SaasQuery } from "./queries";
import type { SaasDoc } from "./documents";

/** Deep enough that 100 DISTINCT documents are reachable at ~2.25 chunks per document. */
const CAND_CHUNKS = 300;
const INSERT_BATCH = 500;
const RECALL_DEPTHS = [10, 30, 50, 100];

class Rollback extends Error {}

const f3 = (n: number) => n.toFixed(3);
const pc = (n: number) => `${(n * 100).toFixed(1)}%`;

interface Hit { chunkId: string; docId: string; score: number }
interface Row { query: SaasQuery; kw: Hit[]; sm: Hit[] }

function toDocs(hits: Hit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.docId)) continue;
    seen.add(h.docId);
    out.push(h.docId);
  }
  return out;
}

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
    success1: keep.length === 0 ? 0 : keep.filter((r) => r.ranked.length > 0 && (r.q.qrels[r.ranked[0]] ?? 0) > 0).length / keep.length,
    n: keep.length,
    perQuery: keep.map((r, i) => ndcgAtGraded([ranked[i]], [graded[i]], 10)),
  };
}

/** Fraction of a query's relevant documents present in the first `k` candidate documents. */
function candidateRecall(docs: string[], qrels: Record<string, number>, k: number): number {
  const rel = Object.keys(qrels);
  if (rel.length === 0) return 0;
  const head = new Set(docs.slice(0, k));
  return rel.filter((d) => head.has(d)).length / rel.length;
}

/**
 * Best achievable ranking of a candidate set, given ground truth.
 *
 * DIAGNOSTIC ONLY. This is not a system result and cannot be deployed — it uses the answers. Its
 * sole purpose is to separate "the document was never retrieved" from "the document was retrieved
 * and ranked badly", because those two demand completely different engineering.
 */
function oracle(docs: string[], qrels: Record<string, number>, k: number): { ndcg10: number; mrr10: number; success1: number } {
  const head = docs.slice(0, k);
  const graded = head.map((d) => ({ id: d, grade: qrels[d] ?? 0 }));
  graded.sort((a, b) => b.grade - a.grade);
  const ideal = graded.map((g) => g.id);
  const relevant = new Map(Object.entries(qrels));
  return {
    ndcg10: ndcgAtGraded([ideal], [{ relevant }], 10),
    mrr10: mrr([ranksFromRanked(ideal, relevant)], [{ relevant: Object.keys(qrels) }]),
    success1: ideal.length > 0 && (qrels[ideal[0]] ?? 0) > 0 ? 1 : 0,
  };
}

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function main() {
  const t0 = Date.now();
  const el = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
  const snapName = process.env.SAASBENCH_SNAPSHOT ?? "d3400-s42";
  const dir = join(process.cwd(), "eval", "saasbench", "snapshots", snapName);

  const documents: SaasDoc[] = (await readFile(join(dir, "documents.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  const queries: SaasQuery[] = JSON.parse(await readFile(join(dir, "queries.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const scenarios = JSON.parse(await readFile(join(dir, "scenarios.json"), "utf8"));

  // Q1: structural validity, before anything expensive.
  const structural = checkStructure(scenarios, documents, queries);
  console.log(`\n[saasbench-diagnose] ${snapName}`);
  console.log(`  ${anchorSummary(scenarios)}`);
  console.log(`  structural: ${structural.length === 0 ? "all rules pass" : `${structural.length} VIOLATION(S)`}`);
  if (structural.length > 0) {
    for (const v of structural) console.log(`   ✗ ${v.rule} (${v.count}): ${v.examples[0]}`);
    console.log("\n  ABORTING — the corpus is malformed; diagnostics on it would be meaningless.\n");
    process.exit(1);
  }

  const judged = queries.filter((q) => Object.keys(q.qrels).length > 0);
  const tune = judged.filter((q) => q.split === "tune");
  const test = judged.filter((q) => q.split === "test");
  console.log(`  ${documents.length} documents · ${judged.length} judged queries (tune ${tune.length} / test ${test.length})`);
  console.log(`  corpus ${manifest.corpusHash.slice(0, 12)} · queries ${manifest.queriesHash.slice(0, 12)} · qrels ${manifest.qrelsHash.slice(0, 12)}`);

  const chunks: { docId: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  for (const d of documents) {
    for (const c of chunkText(`${d.title}\n\n${d.body}`)) {
      chunks.push({ docId: d.id, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }
  console.log(`${el()} ${chunks.length} chunks (${(chunks.length / documents.length).toFixed(2)} per document)`);

  console.log(`${el()} embedding chunks...`);
  const chunkVecs: number[][] = [];
  for (let i = 0; i < chunks.length; i += 2000) {
    chunkVecs.push(...(await embed(chunks.slice(i, i + 2000).map((c) => c.content))));
    console.log(`${el()}   ${Math.min(i + 2000, chunks.length)}/${chunks.length}`);
  }
  console.log(`${el()} embedding ${judged.length} queries...`);
  const queryVecs = await embed(judged.map((q) => q.text));

  const uuidByDoc = new Map(documents.map((d) => [d.id, randomUUID() as string]));
  const docByUuid = new Map([...uuidByDoc].map(([id, uuid]) => [uuid, id]));
  const chunkToDoc = new Map(chunks.map((c) => [c.chunkId, c.docId]));

  const esIndex = await createEphemeralIndex("saasbench_diag");
  const rows: Row[] = [];
  try {
    console.log(`${el()} indexing into Elasticsearch...`);
    const esChunks: EsChunk[] = chunks.map((c) => ({
      chunkId: c.chunkId, documentId: uuidByDoc.get(c.docId)!, chunkIndex: c.index,
      title: "", fileType: "md", content: c.content,
    }));
    for (let i = 0; i < esChunks.length; i += 2000) {
      await indexChunks(esChunks.slice(i, i + 2000), esIndex, i + 2000 >= esChunks.length ? "wait_for" : false);
    }

    console.log(`${el()} keyword retrieval (depth ${CAND_CHUNKS})...`);
    const kwByQuery: Hit[][] = [];
    for (const q of judged) {
      const hits = await keywordSearch(q.text, null, CAND_CHUNKS, esIndex);
      kwByQuery.push(hits.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.documentId)!, score: h.score })));
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
        console.log(`${el()} seeding...`);
        for (let i = 0; i < documents.length; i += INSERT_BATCH) {
          const b = documents.slice(i, i + INSERT_BATCH);
          await tx.$executeRaw`
            INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
            VALUES ${Prisma.join(b.map((d) => Prisma.sql`(${uuidByDoc.get(d.id)}::uuid, ${d.title}, ${`${d.id}.${d.fileType}`}, ${d.fileType}, 'INDEXED', now(), now())`))}`;
        }
        for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
          const b = chunks.slice(i, i + INSERT_BATCH);
          await tx.$executeRaw`
            INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
            VALUES ${Prisma.join(b.map((c, j) => Prisma.sql`(${c.chunkId}::uuid, ${uuidByDoc.get(c.docId)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[i + j])}::vector, now())`))}`;
        }
        console.log(`${el()} semantic retrieval (depth ${CAND_CHUNKS}, exact KNN)...`);
        for (let i = 0; i < judged.length; i++) {
          const vec = toVectorLiteral(queryVecs[i]);
          const sm = await tx.$queryRaw<{ chunkId: string; docUuid: string; score: number }[]>`
            SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docUuid",
                   1 - (dc.embedding <=> ${vec}::vector) AS score
            FROM document_chunks dc WHERE dc.embedding IS NOT NULL
            ORDER BY dc.embedding <=> ${vec}::vector LIMIT ${CAND_CHUNKS}`;
          rows.push({
            query: judged[i], kw: kwByQuery[i],
            sm: sm.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.docUuid)!, score: Number(h.score) })),
          });
        }
        throw new Rollback();
      }, { timeout: 3 * 60 * 60_000, maxWait: 120_000 });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }

  const W = DEFAULT_HYBRID_WEIGHT;
  const asScored = (h: Hit[]): Scored[] => h.map((x) => ({ id: x.chunkId, score: x.score }));
  const chunkRankToDocs = (blend: Scored[]): string[] =>
    toDocs(blend.map((b) => ({ chunkId: b.id, docId: chunkToDoc.get(b.id)!, score: b.score })));

  // ── Task A: shipping baseline (LEGACY fusion) ───────────────────────────
  const rank = {
    keyword: rows.map((r) => toDocs(r.kw)),
    semantic: rows.map((r) => toDocs(r.sm)),
    hybridLegacy: rows.map((r) => chunkRankToDocs(legacyMinMax(asScored(r.kw), asScored(r.sm), W))),
    hybridCorrected: rows.map((r) => chunkRankToDocs(correctedMinMax(asScored(r.kw), asScored(r.sm), W))),
  };
  const qs = rows.map((r) => r.query);
  const idxOf = (pred: (q: SaasQuery) => boolean) => qs.map((q, i) => (pred(q) ? i : -1)).filter((i) => i >= 0);
  const sub = (rk: string[][], idx: number[]) => scoreRankings(idx.map((i) => rk[i]), idx.map((i) => qs[i]));

  const testIdx = idxOf((q) => q.split === "test");
  const tuneIdx = idxOf((q) => q.split === "tune");

  console.log(`\n${el()} ── Task A · shipping baseline (legacy fusion, as it ships) ──\n`);
  for (const [label, idx] of [["test", testIdx], ["tune", tuneIdx]] as const) {
    console.log(`  ${label} split (n=${idx.length})`);
    console.log("    strategy    nDCG@10   MRR@10  Success@1     R@5    R@10");
    for (const s of ["keyword", "semantic", "hybridLegacy"] as const) {
      const m = sub(rank[s], idx);
      console.log(`    ${s.padEnd(12)} ${f3(m.ndcg10)}    ${f3(m.mrr10)}     ${pc(m.success1).padStart(6)}  ${pc(m.r5).padStart(6)}  ${pc(m.r10).padStart(6)}`);
    }
    console.log("");
  }

  const classes = [...new Set(qs.map((q) => q.queryClass))].sort();
  console.log("  per class, test split (nDCG@10 / MRR@10):");
  console.log("    class                  n   keyword        semantic       hybrid");
  const perClass: Record<string, Record<string, { ndcg10: number; mrr10: number; n: number }>> = {};
  for (const c of classes) {
    const idx = idxOf((q) => q.queryClass === c && q.split === "test");
    if (idx.length === 0) continue;
    const k = sub(rank.keyword, idx), s = sub(rank.semantic, idx), h = sub(rank.hybridLegacy, idx);
    perClass[c] = { keyword: { ndcg10: k.ndcg10, mrr10: k.mrr10, n: k.n }, semantic: { ndcg10: s.ndcg10, mrr10: s.mrr10, n: s.n }, hybrid: { ndcg10: h.ndcg10, mrr10: h.mrr10, n: h.n } };
    console.log(`    ${c.padEnd(20)} ${String(k.n).padStart(4)}   ${f3(k.ndcg10)}/${f3(k.mrr10)}   ${f3(s.ndcg10)}/${f3(s.mrr10)}   ${f3(h.ndcg10)}/${f3(h.mrr10)}`);
  }

  // ── Task B: candidate recall ────────────────────────────────────────────
  console.log(`\n${el()} ── Task B · candidate recall (documents, test split) ──\n`);
  const unionDocs = rows.map((r) => {
    const seen = new Set<string>();
    const out: string[] = [];
    // Interleave the legs so "union@k" means k candidates drawn fairly, not k from one leg.
    const a = toDocs(r.kw), b = toDocs(r.sm);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      for (const d of [a[i], b[i]]) if (d && !seen.has(d)) { seen.add(d); out.push(d); }
    }
    return out;
  });
  const recall: Record<string, Record<number, number>> = { keyword: {}, semantic: {}, union: {} };
  console.log("    leg          " + RECALL_DEPTHS.map((d) => `R@${d}`.padStart(8)).join(""));
  for (const [leg, docs] of [["keyword", rank.keyword], ["semantic", rank.semantic], ["union", unionDocs]] as const) {
    const line: string[] = [];
    for (const d of RECALL_DEPTHS) {
      const v = testIdx.map((i) => candidateRecall(docs[i], qs[i].qrels, d)).reduce((a, b) => a + b, 0) / testIdx.length;
      recall[leg][d] = v;
      line.push(pc(v).padStart(8));
    }
    console.log(`    ${leg.padEnd(12)}` + line.join(""));
  }

  // ── Task C: oracle ceiling ──────────────────────────────────────────────
  console.log(`\n${el()} ── Task C · ORACLE ceiling on the union — NOT DEPLOYABLE, NOT A SYSTEM RESULT ──\n`);
  const oracleAt: Record<number, { ndcg10: number; mrr10: number; success1: number }> = {};
  console.log("    depth   oracle nDCG@10   oracle MRR@10   oracle Success@1");
  for (const d of [30, 100]) {
    const vals = testIdx.map((i) => oracle(unionDocs[i], qs[i].qrels, d));
    const avg = {
      ndcg10: vals.reduce((a, b) => a + b.ndcg10, 0) / vals.length,
      mrr10: vals.reduce((a, b) => a + b.mrr10, 0) / vals.length,
      success1: vals.reduce((a, b) => a + b.success1, 0) / vals.length,
    };
    oracleAt[d] = avg;
    console.log(`    ${String(d).padStart(5)}   ${f3(avg.ndcg10).padStart(13)}   ${f3(avg.mrr10).padStart(13)}   ${pc(avg.success1).padStart(16)}`);
  }

  // ── Task D: chunk → document collapse ───────────────────────────────────
  console.log(`\n${el()} ── Task D · chunk-to-document collapse ──\n`);
  const collapse: Record<string, Record<number, Record<string, number>>> = {};
  console.log("    leg        chunks   unique docs (mean / median / p25 / p75 / p95 / min / max)   wasted slots");
  for (const [leg, get] of [["keyword", (r: Row) => r.kw], ["semantic", (r: Row) => r.sm]] as const) {
    collapse[leg] = {};
    for (const depth of [10, 30, 50, 100]) {
      const uniques = testIdx.map((i) => new Set(get(rows[i]).slice(0, depth).map((h) => h.docId)).size);
      const mean = uniques.reduce((a, b) => a + b, 0) / uniques.length;
      const stats = { mean, median: quantile(uniques, 0.5), p25: quantile(uniques, 0.25), p75: quantile(uniques, 0.75), p95: quantile(uniques, 0.95), min: Math.min(...uniques), max: Math.max(...uniques) };
      collapse[leg][depth] = stats;
      const wasted = 1 - mean / depth;
      console.log(`    ${leg.padEnd(10)} ${String(depth).padStart(6)}   ${mean.toFixed(1)} / ${stats.median} / ${stats.p25} / ${stats.p75} / ${stats.p95} / ${stats.min} / ${stats.max}`.padEnd(78) + `${pc(wasted).padStart(8)}`);
    }
  }

  // ── Task F: legacy vs corrected fusion ──────────────────────────────────
  console.log(`\n${el()} ── Task F · legacy vs corrected fusion (test split, paired bootstrap) ──\n`);
  const legacyM = sub(rank.hybridLegacy, testIdx);
  const correctedM = sub(rank.hybridCorrected, testIdx);
  const fusionDelta = bootstrapDelta(correctedM.perQuery, legacyM.perQuery);
  const droppedPerQuery = testIdx.map((i) =>
    correctedMinMax(asScored(rows[i].kw), asScored(rows[i].sm), W).length -
    legacyMinMax(asScored(rows[i].kw), asScored(rows[i].sm), W).length);
  const meanDropped = droppedPerQuery.reduce((a, b) => a + b, 0) / droppedPerQuery.length;
  console.log(`    candidates silently dropped by the legacy path: ${meanDropped.toFixed(2)} per query (max ${Math.max(...droppedPerQuery)})`);
  console.log("    variant       nDCG@10   MRR@10  Success@1    R@10");
  for (const [name, m] of [["legacy", legacyM], ["corrected", correctedM]] as const) {
    console.log(`    ${name.padEnd(12)} ${f3(m.ndcg10)}    ${f3(m.mrr10)}     ${pc(m.success1).padStart(6)}  ${pc(m.r10).padStart(6)}`);
  }
  console.log(`    Δ nDCG@10 ${f3(fusionDelta.value)} [${f3(fusionDelta.lo)}, ${f3(fusionDelta.hi)}] ${fusionDelta.excludesZero ? "excludes zero" : "includes zero"} (n=${legacyM.n})`);

  // ── Task G: document aggregation, TUNE SPLIT ONLY ───────────────────────
  console.log(`\n${el()} ── Task G · document aggregation (TUNE split only) ──\n`);
  const bestChunkPerDoc = (hits: Hit[]): Scored[] => {
    const best = new Map<string, number>();
    for (const h of hits) if (!best.has(h.docId) || h.score > best.get(h.docId)!) best.set(h.docId, h.score);
    return [...best].map(([id, score]) => ({ id, score }));
  };
  const supportingBonus = (hits: Hit[]): Scored[] => {
    const byDoc = new Map<string, number[]>();
    for (const h of hits) (byDoc.get(h.docId) ?? byDoc.set(h.docId, []).get(h.docId)!).push(h.score);
    // Capped so a document cannot win by having many chunks: at most one extra chunk contributes,
    // and only at a quarter weight.
    return [...byDoc].map(([id, ss]) => {
      const sorted = ss.sort((a, b) => b - a);
      return { id, score: sorted[0] + 0.25 * (sorted[1] ?? 0) };
    });
  };
  const variantB = rows.map((r) => correctedMinMax(bestChunkPerDoc(r.kw), bestChunkPerDoc(r.sm), W).map((s) => s.id));
  const variantC = rows.map((r) => correctedMinMax(supportingBonus(r.kw), supportingBonus(r.sm), W).map((s) => s.id));
  const aggA = sub(rank.hybridCorrected, tuneIdx);
  const aggB = sub(variantB, tuneIdx);
  const aggC = sub(variantC, tuneIdx);
  console.log("    variant                                   nDCG@10   MRR@10  Success@1    R@10");
  for (const [name, m] of [["A chunk fusion → first-occurrence", aggA], ["B per-leg best-chunk → doc fusion", aggB], ["C best chunk + capped support", aggC]] as const) {
    console.log(`    ${name.padEnd(40)} ${f3(m.ndcg10)}    ${f3(m.mrr10)}     ${pc(m.success1).padStart(6)}  ${pc(m.r10).padStart(6)}`);
  }
  const dB = bootstrapDelta(aggB.perQuery, aggA.perQuery);
  const dC = bootstrapDelta(aggC.perQuery, aggA.perQuery);
  console.log(`    B − A  Δ nDCG@10 ${f3(dB.value)} [${f3(dB.lo)}, ${f3(dB.hi)}] ${dB.excludesZero ? "excludes zero" : "includes zero"}`);
  console.log(`    C − A  Δ nDCG@10 ${f3(dC.value)} [${f3(dC.lo)}, ${f3(dC.hi)}] ${dC.excludesZero ? "excludes zero" : "includes zero"}`);

  // ── artifacts ───────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), "eval", "saasbench", "results");
  await mkdir(outDir, { recursive: true });
  const env = {
    snapshot: snapName,
    corpusHash: manifest.corpusHash, queriesHash: manifest.queriesHash, qrelsHash: manifest.qrelsHash,
    generatorVersion: manifest.generatorVersion, seed: manifest.seed,
    documents: documents.length, chunks: chunks.length, chunksPerDocument: chunks.length / documents.length,
    tuneQueries: tune.length, testQueries: test.length,
    candidateChunkDepth: CAND_CHUNKS, embeddingModel: "Xenova/all-MiniLM-L6-v2", hybridWeight: W,
    gitSha: process.env.GIT_SHA ?? null,
  };
  await writeFile(join(outDir, "baseline.json"), JSON.stringify({ env, note: "LEGACY fusion — the shipping before-state", test: { keyword: sub(rank.keyword, testIdx), semantic: sub(rank.semantic, testIdx), hybrid: legacyM }, tune: { keyword: sub(rank.keyword, tuneIdx), semantic: sub(rank.semantic, tuneIdx), hybrid: sub(rank.hybridLegacy, tuneIdx) }, perClass }, null, 2));
  await writeFile(join(outDir, "candidate-recall.json"), JSON.stringify({ env, depths: RECALL_DEPTHS, recall }, null, 2));
  await writeFile(join(outDir, "oracle-ceiling.json"), JSON.stringify({ env, warning: "ORACLE — NOT DEPLOYABLE, NOT A SYSTEM RESULT, NOT RESUME-SAFE", oracle: oracleAt }, null, 2));
  await writeFile(join(outDir, "chunk-collapse.json"), JSON.stringify({ env, collapse }, null, 2));
  await writeFile(join(outDir, "fusion-fix.json"), JSON.stringify({ env, meanCandidatesDropped: meanDropped, legacy: legacyM, corrected: correctedM, delta: fusionDelta }, null, 2));
  await writeFile(join(outDir, "aggregation.json"), JSON.stringify({ env, split: "tune", variantA: aggA, variantB: aggB, variantC: aggC, deltaB: dB, deltaC: dC }, null, 2));
  console.log(`\n${el()} artifacts -> ${outDir}\n`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
