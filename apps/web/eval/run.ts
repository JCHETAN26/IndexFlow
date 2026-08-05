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
  console.log(
    `* Scored on ${r.dataset.numTestJudged} of ${r.dataset.numTest} held-out queries — ` +
      `${r.dataset.numTest - r.dataset.numTestJudged} has no relevant document and is excluded ` +
      `from every ranking metric (measured separately below)`,
  );
  // Read the model names from the code that actually runs, never a hardcoded string —
  // a stale literal here silently mislabels every captured result.
  console.log(`* Chunking: semantic chunker`);
  console.log(`* Embedding: ${EMBED_MODEL} (${EMBED_DIM}-dim)`);
  console.log(`* Reranker: ${RERANK_MODEL}`);
  // Read from the report, never a literal. This line used to claim "10 chunks per strategy"
  // while the keyword leg retrieved every chunk in the corpus.
  console.log(
    `* Initial retrieval: keyword ${r.depths.keyword} / semantic ${r.depths.semantic} chunks ` +
      `(production CANDIDATE_LIMIT, clamped to corpus size)`,
  );
  console.log(`* Reranker input: Top 10 blended chunks`);
  
  console.log("─".repeat(80));
  console.log("Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5");
  console.log("─".repeat(80));
  for (const s of strategies) {
    const m = r.strategies[s];
    const row = [m.recall[1], m.recall[3], m.recall[5], m.precision[3], m.ndcg[5]].map(pct).join("   ");
    console.log(`${s.padEnd(15)}  ${f2(m.mrr)}   ${row}`);
  }

  // The ceiling is printed permanently, not as a one-off analysis. A metric whose attainable
  // maximum is below 1 is unreadable without it: P@3 = 36% looks like a poor precision until you
  // can see that 37% is everything the label density allows.
  const c = r.ceilings;
  const ceilRow = [c.recall[1], c.recall[3], c.recall[5], c.precision[3], c.ndcg[5]]
    .map(pct)
    .join("   ");
  console.log(`${"ceiling".padEnd(15)}  ${f2(c.mrr)}   ${ceilRow}`);
  console.log("─".repeat(80));
  console.log("as % of attainable ceiling:");
  for (const s of strategies) {
    const m = r.strategies[s];
    const of = (v: number, ceil: number) => pct(ceil === 0 ? 0 : v / ceil);
    const row = [
      of(m.recall[1], c.recall[1]),
      of(m.recall[3], c.recall[3]),
      of(m.recall[5], c.recall[5]),
      of(m.precision[3], c.precision[3]),
      of(m.ndcg[5], c.ndcg[5]),
    ].join("   ");
    console.log(`${s.padEnd(15)} ${of(m.mrr, c.mrr)}   ${row}`);
  }
  console.log("─".repeat(80));
  console.log("95% MARGINAL bootstrap intervals (held-out):");
  for (const s of strategies) {
    console.log(
      `  ${s.padEnd(15)} MRR ${iv(r.ci.mrr[s]).padEnd(18)} R@1 ${iv(r.ci.r1[s]).padEnd(18)} R@5 ${iv(r.ci.r5[s])}`,
    );
  }
  console.log("");
  console.log("95% PAIRED bootstrap intervals on the per-query MRR difference (held-out):");
  console.log("  Marginal intervals above CANNOT settle 'is A better than B' — the strategies are");
  console.log("  scored on the same queries, so the comparison is paired. Overlapping marginal");
  console.log("  intervals do not imply an insignificant difference.");
  for (const d of r.deltas) {
    const sig = d.delta.excludesZero ? "SIGNIFICANT" : "not significant";
    console.log(
      `  Δ MRR ${(d.a + " − " + d.b).padEnd(31)} ${d.delta.value >= 0 ? "+" : ""}${f2(d.delta.value)} ` +
        `[${f2(d.delta.lo)}, ${f2(d.delta.hi)}]   excludes zero: ${d.delta.excludesZero ? "yes" : "no "}   ${sig}`,
    );
  }
  console.log("─".repeat(80));
  const rj = r.rejection;
  console.log(
    `rejection — ${rj.numUnanswerable} unanswerable / ${rj.numAnswerable} answerable held-out queries:`,
  );
  for (const leg of ["keyword", "semantic"] as const) {
    const s = rj.legs[leg];
    const tops = s.unanswerableTop.map((v) => v.toFixed(3)).join(", ") || "—";
    console.log(
      `  ${leg.padEnd(9)} unanswerable top ${tops}   ` +
        `answerable top min ${s.answerableTop.min.toFixed(3)} / med ${s.answerableTop.median.toFixed(3)} / max ${s.answerableTop.max.toFixed(3)}   ` +
        `${s.separable ? "separable" : "NOT separable"}`,
    );
  }
  console.log(`  hybrid    not measurable — min-max normalisation puts every query's top at 1.000`);
  console.log(`  ${rj.caveat}`);
  console.log("─".repeat(80));
  console.log("by query kind (R@1 / MRR), HELD-OUT — this is what the gate scores:");
  console.log("            keyword        semantic       hybrid         hybrid+rerank");
  for (const kind of ["exact", "paraphrase"] as const) {
    const cells = strategies
      .map((s) => `${pct(r.byKind[kind][s].r1)} / ${f2(r.byKind[kind][s].mrr)}`.padStart(15))
      .join("");
    console.log(`${kind.padEnd(12)}${cells}`);
  }
  console.log("");
  console.log("same, whole set (tune+test) — for continuity with numbers published before 2026-08-05:");
  for (const kind of ["exact", "paraphrase"] as const) {
    const cells = strategies
      .map((s) => `${pct(r.byKindAll[kind][s].r1)} / ${f2(r.byKindAll[kind][s].mrr)}`.padStart(15))
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
