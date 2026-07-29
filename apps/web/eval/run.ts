/**
 * CLI entry point for the retrieval evaluation. Prints a comparison table + weight
 * sweep and exits non-zero if the quality gate fails (used as a CI check).
 *
 * Run: pnpm --filter @indexflow/web eval
 */
import { prisma } from "../lib/prisma";
import { EMBED_DIM, EMBED_MODEL } from "../lib/embed";
import { RERANK_MODEL } from "../lib/rerank";
import { runEvaluation, type EvalReport } from "./harness";

const pct = (n: number) => (n * 100).toFixed(0).padStart(3) + "%";
const f2 = (n: number) => n.toFixed(2);

function print(r: EvalReport) {
  const strategies = ["keyword", "semantic", "hybrid", "hybrid+rerank"] as const;

  const iv = (i: { value: number; lo: number; hi: number }) =>
    `${pct(i.value).trim()} [${pct(i.lo).trim()}–${pct(i.hi).trim()}]`;

  console.log(`\nRetrieval eval — ${r.numQueries} queries over ${r.numDocs} docs`);
  console.log(
    `* Dataset ${r.dataset.version} (queries ${r.dataset.queriesSha}, corpus ${r.dataset.corpusSha})`,
  );
  console.log(
    `* Split: ${r.dataset.numTune} tuning (weight chosen here) / ${r.dataset.numTest} held-out (reported below)`,
  );
  // Read the model names from the code that actually runs, never a hardcoded string —
  // a stale literal here silently mislabels every captured result.
  console.log(`* Chunking: semantic chunker`);
  console.log(`* Embedding: ${EMBED_MODEL} (${EMBED_DIM}-dim)`);
  console.log(`* Reranker: ${RERANK_MODEL}`);
  console.log(`* Initial retrieval: 10 chunks per strategy`);
  console.log(`* Reranker input: Top 10 blended chunks`);
  
  console.log("─".repeat(80));
  console.log("Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5");
  console.log("─".repeat(80));
  for (const s of strategies) {
    const m = r.strategies[s];
    const row = [m.recall[1], m.recall[3], m.recall[5], m.precision[3], m.ndcg[5]].map(pct).join("   ");
    console.log(`${s.padEnd(15)}  ${f2(m.mrr)}   ${row}`);
  }
  console.log("─".repeat(80));
  console.log("held-out hybrid, with 95% bootstrap intervals:");
  console.log(`  MRR  ${iv(r.ci.hybridMrr)}     R@1  ${iv(r.ci.hybridR1)}     R@5  ${iv(r.ci.hybridR5)}`);
  console.log("  (intervals this wide on a set this size mean small gaps are not rankings)");
  console.log("─".repeat(80));
  console.log("by query kind (R@1 / MRR), whole set:");
  console.log("            keyword        semantic       hybrid         hybrid+rerank");
  for (const kind of ["exact", "paraphrase"] as const) {
    const cells = strategies
      .map((s) => `${pct(r.byKind[kind][s].r1)} / ${f2(r.byKind[kind][s].mrr)}`.padStart(15))
      .join("");
    console.log(`${kind.padEnd(12)}${cells}`);
  }
  console.log("─".repeat(80));
  console.log(`hybrid weight sweep on the TUNING split (keyword weight → MRR), best = ${f2(r.hybridWeight)}:`);
  console.log(
    r.sweep.map((s) => `${f2(s.weight)}:${f2(s.mrr)}${s.weight === r.hybridWeight ? "*" : " "}`).join("  "),
  );
  console.log("─".repeat(80));
  
  if (r.regressions && r.regressions.length > 0) {
    console.log(`Reranker Regressions (${r.regressions.length} queries):`);
    for (const reg of r.regressions) {
      console.log(`  Query: "${reg.query}"`);
      console.log(`  Expected: ${reg.expectedDoc}`);
      console.log(`  Ranks: Hybrid #${reg.hybridRank} -> Reranked #${reg.rerankRank ?? "Dropped"}`);
      console.log(`  Scores: KW=${f2(reg.kwScore)} / SM=${f2(reg.smScore)} / Rerank=${reg.rerankerScore !== null ? f2(reg.rerankerScore) : "N/A"}`);
      console.log(`  Analysis: ${reg.likelyReason}\n`);
    }
    console.log("─".repeat(80));
  }

  console.log("quality gate:");
  for (const row of r.gate) {
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name}: ${pct(row.value)} (floor ${pct(row.floor)})`);
  }
  console.log("─".repeat(80));
}

runEvaluation()
  .then(async (report) => {
    print(report);
    await prisma.$disconnect();
    if (report.passed) {
      console.log("\nQuality gate passed. ✓");
    } else {
      console.error("\nQuality gate FAILED — retrieval regressed below floor.");
      process.exitCode = 1;
    }
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
