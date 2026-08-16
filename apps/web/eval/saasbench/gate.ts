/**
 * SaaSBench benchmark-quality gate (remediation Phase 3).
 *
 * This decides whether SaaSBench is worth scaling. A generated benchmark can fail in a way that
 * looks like success: if documents and queries share a vocabulary, every strategy scores ~0.95, the
 * numbers look wonderful, and the benchmark measures its own templates. IndexFlow has published a
 * saturated benchmark once already — `R@5 = 97%` that was really 100% of attainable, for three
 * strategies simultaneously, with a zero-width confidence interval. The point of this gate is to
 * catch that *before* burning CI on 100,000 documents.
 *
 * A benchmark that is too easy is not a good result. It is a broken instrument.
 *
 * ## Checks
 *
 * 1. **Not saturated** — no strategy may exceed a ceiling on nDCG@10 or Success@1.
 * 2. **Discriminative** — the best and worst strategy must differ by more than a trivial margin.
 *    Three strategies tied is the signature of a benchmark that cannot tell them apart.
 * 3. **BM25 does not trivially win** — if lexical matching alone solves the paraphrase and
 *    troubleshooting classes, the vocabularies leaked.
 * 4. **Hard negatives bite** — the hard-negative class must be measurably harder than the
 *    identifier class, or the near-miss construction is not working.
 * 5. **No class is degenerate** — every class needs enough queries and a non-zero score, so a
 *    headline average is not carried by one easy class.
 *
 * Thresholds are deliberately two-sided. Scoring too *low* everywhere is also a failure — it means
 * the queries are unanswerable rather than hard, which is its own kind of broken.
 *
 *   pnpm --filter @indexflow/web saasbench:gate -- --snapshot d3359-s42
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { chunkText } from "../../lib/chunk";
import { embed, toVectorLiteral } from "../../lib/embed";
import { blendHybrid, DEFAULT_HYBRID_WEIGHT } from "../../lib/hybrid";
import { createEphemeralIndex, deleteIndex, indexChunks, keywordSearch, type EsChunk } from "../../lib/es";
import { ndcgAtGraded, ranksFromRanked, mrr, recallAt, bootstrapDelta } from "../metrics";
import type { SaasDoc } from "./documents";
import type { SaasQuery } from "./queries";

const DEPTH = 50;
const INSERT_BATCH = 500;

class Rollback extends Error {}

interface Hit {
  chunkId: string;
  docId: string;
  score: number;
}
interface Row {
  query: SaasQuery;
  kw: Hit[];
  sm: Hit[];
}

const f3 = (n: number) => n.toFixed(3);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Collapse a chunk-level ranking to a document-level one, keeping first occurrence. */
function toDocRanking(hits: Hit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.docId)) continue;
    seen.add(h.docId);
    out.push(h.docId);
  }
  return out;
}

interface Scores {
  ndcg10: number;
  mrr10: number;
  r5: number;
  r10: number;
  success1: number;
  n: number;
  perQueryNdcg: number[];
}

function score(rankings: string[][], queries: SaasQuery[]): Scores {
  // Ranking metrics are defined only over queries that have something to rank. Unanswerable
  // queries are excluded here and reported separately — putting them in a denominator is the
  // exact defect that capped the previous benchmark at 33/34.
  const keep = queries.map((q, i) => ({ q, ranked: rankings[i] })).filter((r) => Object.keys(r.q.qrels).length > 0);
  const graded = keep.map((r) => ({ relevant: new Map(Object.entries(r.q.qrels)) }));
  const ranked = keep.map((r) => r.ranked);
  const binary = keep.map((r) => ({ relevant: Object.keys(r.q.qrels) }));
  const ranks = keep.map((r) => ranksFromRanked(r.ranked, new Map(Object.entries(r.q.qrels))));

  const perQueryNdcg = keep.map((r, i) => ndcgAtGraded([ranked[i]], [graded[i]], 10));
  const success1 =
    keep.length === 0
      ? 0
      : keep.filter((r) => r.ranked.length > 0 && (r.q.qrels[r.ranked[0]] ?? 0) > 0).length / keep.length;

  return {
    ndcg10: ndcgAtGraded(ranked, graded, 10),
    mrr10: mrr(ranks, binary),
    r5: recallAt(ranks, binary, 5),
    r10: recallAt(ranks, binary, 10),
    success1,
    n: keep.length,
    perQueryNdcg,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--snapshot");
  const snapName = i >= 0 && args[i + 1] ? args[i + 1] : "d3359-s42";
  const dir = join(process.cwd(), "eval", "saasbench", "snapshots", snapName);

  const documents: SaasDoc[] = (await readFile(join(dir, "documents.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const queries: SaasQuery[] = JSON.parse(await readFile(join(dir, "queries.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));

  // The gate runs on the TEST split only. Nothing here tunes anything, but scoring on the tuning
  // split would still be measuring on data reserved for choosing configuration later.
  const test = queries.filter((q) => q.split === "test");

  console.log(`\n[saasbench-gate] ${snapName}`);
  console.log(`  ${documents.length} documents · ${test.length} test queries · seed ${manifest.seed}`);
  console.log(`  corpus ${manifest.corpusHash.slice(0, 12)} · queries ${manifest.queriesHash.slice(0, 12)}\n`);

  const t0 = Date.now();
  const el = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

  const chunks: { docId: string; chunkId: string; index: number; content: string; tokenCount: number }[] = [];
  for (const d of documents) {
    for (const c of chunkText(`${d.title}\n\n${d.body}`)) {
      chunks.push({ docId: d.id, chunkId: randomUUID(), index: c.index, content: c.content, tokenCount: c.tokenCount });
    }
  }
  console.log(`${el()} ${chunks.length} chunks (${(chunks.length / documents.length).toFixed(2)} per document)`);

  console.log(`${el()} embedding chunks...`);
  const chunkVecs = await embed(chunks.map((c) => c.content));
  console.log(`${el()} embedding queries...`);
  const queryVecs = await embed(test.map((q) => q.text));

  const uuidByDoc = new Map(documents.map((d) => [d.id, randomUUID() as string]));
  const docByUuid = new Map([...uuidByDoc].map(([id, uuid]) => [uuid, id]));

  const esIndex = await createEphemeralIndex("saasbench");
  const rows: Row[] = [];
  try {
    console.log(`${el()} indexing into Elasticsearch...`);
    const esChunks: EsChunk[] = chunks.map((c) => ({
      chunkId: c.chunkId,
      documentId: uuidByDoc.get(c.docId)!,
      chunkIndex: c.index,
      title: "",
      fileType: "md",
      content: c.content,
    }));
    for (let k = 0; k < esChunks.length; k += 2000) {
      await indexChunks(esChunks.slice(k, k + 2000), esIndex, k + 2000 >= esChunks.length ? "wait_for" : false);
    }

    console.log(`${el()} keyword retrieval...`);
    const kwByQuery: Hit[][] = [];
    for (const q of test) {
      const hits = await keywordSearch(q.text, null, DEPTH, esIndex);
      kwByQuery.push(hits.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.documentId)!, score: h.score })));
    }

    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
          await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

          console.log(`${el()} seeding documents + chunks...`);
          for (let k = 0; k < documents.length; k += INSERT_BATCH) {
            const batch = documents.slice(k, k + INSERT_BATCH);
            await tx.$executeRaw`
              INSERT INTO documents (id, title, "fileName", "fileType", status, "uploadedAt", "indexedAt")
              VALUES ${Prisma.join(
                batch.map(
                  (d) =>
                    Prisma.sql`(${uuidByDoc.get(d.id)}::uuid, ${d.title}, ${`${d.id}.${d.fileType}`}, ${d.fileType}, 'INDEXED', now(), now())`,
                ),
              )}
            `;
          }
          for (let k = 0; k < chunks.length; k += INSERT_BATCH) {
            const batch = chunks.slice(k, k + INSERT_BATCH);
            await tx.$executeRaw`
              INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
              VALUES ${Prisma.join(
                batch.map(
                  (c, j) =>
                    Prisma.sql`(${c.chunkId}::uuid, ${uuidByDoc.get(c.docId)}::uuid, ${c.index}, ${c.content}, ${c.tokenCount}, ${toVectorLiteral(chunkVecs[k + j])}::vector, now())`,
                ),
              )}
            `;
          }

          console.log(`${el()} semantic retrieval (exact KNN)...`);
          for (let k = 0; k < test.length; k++) {
            const vec = toVectorLiteral(queryVecs[k]);
            const sm = await tx.$queryRaw<{ chunkId: string; docUuid: string; score: number }[]>`
              SELECT dc.id::text AS "chunkId", dc."documentId"::text AS "docUuid",
                     1 - (dc.embedding <=> ${vec}::vector) AS score
              FROM document_chunks dc
              WHERE dc.embedding IS NOT NULL
              ORDER BY dc.embedding <=> ${vec}::vector
              LIMIT ${DEPTH}
            `;
            rows.push({
              query: test[k],
              kw: kwByQuery[k],
              sm: sm.map((h) => ({ chunkId: h.chunkId, docId: docByUuid.get(h.docUuid)!, score: Number(h.score) })),
            });
          }
          throw new Rollback();
        },
        { timeout: 45 * 60_000, maxWait: 60_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  } finally {
    await deleteIndex(esIndex).catch(() => {});
  }

  // ── score the three strategies ──────────────────────────────────────────
  const chunkToDoc = new Map(chunks.map((c) => [c.chunkId, c.docId]));
  const rankings = {
    keyword: rows.map((r) => toDocRanking(r.kw)),
    semantic: rows.map((r) => toDocRanking(r.sm)),
    hybrid: rows.map((r) => {
      const blended = blendHybrid(
        r.kw.map((h) => ({ id: h.chunkId, score: h.score })),
        r.sm.map((h) => ({ id: h.chunkId, score: h.score })),
        DEFAULT_HYBRID_WEIGHT,
      );
      return toDocRanking(blended.map((b) => ({ chunkId: b.id, docId: chunkToDoc.get(b.id)!, score: b.score })));
    }),
  };
  const qs = rows.map((r) => r.query);
  const scores = {
    keyword: score(rankings.keyword, qs),
    semantic: score(rankings.semantic, qs),
    hybrid: score(rankings.hybrid, qs),
  };

  console.log(`\n${el()} results (test split, n=${scores.hybrid.n} judged)\n`);
  console.log("  strategy    nDCG@10   MRR@10    R@5     R@10   Success@1");
  for (const [name, s] of Object.entries(scores)) {
    console.log(
      `  ${name.padEnd(10)} ${f3(s.ndcg10).padStart(7)} ${f3(s.mrr10).padStart(8)} ` +
        `${pct(s.r5).padStart(7)} ${pct(s.r10).padStart(7)} ${pct(s.success1).padStart(9)}`,
    );
  }

  // ── per class ───────────────────────────────────────────────────────────
  const classes = [...new Set(qs.map((q) => q.queryClass))].sort();
  console.log("\n  by query class (nDCG@10):");
  console.log("  class                  n   keyword  semantic   hybrid");
  const perClass: Record<string, { keyword: number; semantic: number; hybrid: number; n: number }> = {};
  for (const c of classes) {
    const idx = qs.map((q, k) => (q.queryClass === c ? k : -1)).filter((k) => k >= 0);
    if (idx.length === 0) continue;
    const sub = (rk: string[][]) => score(idx.map((k) => rk[k]), idx.map((k) => qs[k]));
    const k = sub(rankings.keyword), s = sub(rankings.semantic), h = sub(rankings.hybrid);
    perClass[c] = { keyword: k.ndcg10, semantic: s.ndcg10, hybrid: h.ndcg10, n: k.n };
    console.log(
      `  ${c.padEnd(20)} ${String(k.n).padStart(4)}   ${f3(k.ndcg10)}     ${f3(s.ndcg10)}    ${f3(h.ndcg10)}`,
    );
  }

  const best = Object.entries(scores).reduce((a, b) => (b[1].ndcg10 > a[1].ndcg10 ? b : a));
  const worst = Object.entries(scores).reduce((a, b) => (b[1].ndcg10 < a[1].ndcg10 ? b : a));
  const delta = bootstrapDelta(best[1].perQueryNdcg, worst[1].perQueryNdcg);

  // ── the gate ────────────────────────────────────────────────────────────
  const SATURATION_NDCG = 0.85;
  const SATURATION_SUCCESS = 0.9;
  const FLOOR_NDCG = 0.15;
  const MIN_SPREAD = 0.02;
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [name, s] of Object.entries(scores)) {
    if (s.ndcg10 > SATURATION_NDCG)
      failures.push(`${name} nDCG@10 ${f3(s.ndcg10)} exceeds the saturation ceiling ${SATURATION_NDCG} — the benchmark cannot distinguish configurations above this`);
    if (s.success1 > SATURATION_SUCCESS)
      failures.push(`${name} Success@1 ${pct(s.success1)} exceeds ${pct(SATURATION_SUCCESS)} — nearly every query resolves at rank 1`);
    if (s.ndcg10 < FLOOR_NDCG)
      failures.push(`${name} nDCG@10 ${f3(s.ndcg10)} is below the floor ${FLOOR_NDCG} — queries may be unanswerable rather than hard`);
  }

  const spread = best[1].ndcg10 - worst[1].ndcg10;
  if (spread < MIN_SPREAD)
    failures.push(`strategies are indistinguishable: best ${best[0]} ${f3(best[1].ndcg10)} vs worst ${worst[0]} ${f3(worst[1].ndcg10)}, spread ${f3(spread)} < ${MIN_SPREAD}`);
  else if (!delta.excludesZero)
    warnings.push(`best-vs-worst spread ${f3(spread)} has CI [${f3(delta.lo)}, ${f3(delta.hi)}] which includes zero — separation is not statistically supported at this corpus size`);

  const para = perClass["paraphrase"];
  if (para && para.keyword > 0.75)
    failures.push(`BM25 scores ${f3(para.keyword)} on paraphrase queries — lexical matching should not solve a class built from a disjoint vocabulary; suspect a lexicon leak`);

  const hn = perClass["hard-negative"], ident = perClass["identifier"];
  if (hn && ident && hn.hybrid >= ident.hybrid)
    warnings.push(`hard-negative (${f3(hn.hybrid)}) is not harder than identifier (${f3(ident.hybrid)}) — near-miss construction may not be biting`);

  for (const [c, v] of Object.entries(perClass)) {
    // Unanswerable queries have no judged set by design, so their count is not a defect.
    if (c === "unanswerable") continue;
    if (v.n < 20) warnings.push(`class ${c} has only ${v.n} judged queries — too few to read on its own`);
  }

  console.log(`\n  best ${best[0]} ${f3(best[1].ndcg10)} · worst ${worst[0]} ${f3(worst[1].ndcg10)} · spread ${f3(spread)} [${f3(delta.lo)}, ${f3(delta.hi)}]`);
  const unanswerable = queries.filter((q) => q.queryClass === "unanswerable").length;
  console.log(`  ${unanswerable} unanswerable queries excluded from every ranking metric (reported, not scored)`);

  console.log("");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const f of failures) console.log(`  ✗ ${f}`);

  if (failures.length > 0) {
    console.log(`\n  GATE: FAIL — ${failures.length} blocking issue(s). Do NOT scale this generator.\n`);
    process.exit(1);
  }
  console.log(`\n  GATE: PASS${warnings.length ? ` (${warnings.length} warning(s))` : ""} — the benchmark discriminates. Scaling is justified.\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
