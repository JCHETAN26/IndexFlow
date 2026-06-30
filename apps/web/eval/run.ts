/**
 * CLI entry point for the retrieval evaluation. Prints a comparison table + weight
 * sweep and exits non-zero if the quality gate fails (used as a CI check).
 *
 * Run: pnpm --filter @indexflow/web eval
 */
import { prisma } from "../lib/prisma";
import { runEvaluation, type EvalReport } from "./harness";

const pct = (n: number) => (n * 100).toFixed(0).padStart(3) + "%";
const f2 = (n: number) => n.toFixed(2);

function print(r: EvalReport) {
  const strategies = ["keyword", "semantic", "hybrid"] as const;

  console.log(`\nRetrieval eval — ${r.numQueries} queries over ${r.numDocs} docs`);
  console.log("─".repeat(52));
  console.log("strategy    R@1   R@3   R@5    MRR");
  console.log("─".repeat(52));
  for (const s of strategies) {
    const m = r.strategies[s];
    const row = [m.recall[1], m.recall[3], m.recall[5]].map(pct).join("  ");
    console.log(`${s.padEnd(10)} ${row}   ${f2(m.mrr)}`);
  }
  console.log("─".repeat(52));
  console.log("by query kind (R@1 / MRR):");
  console.log("              keyword       semantic       hybrid");
  for (const kind of ["exact", "paraphrase"] as const) {
    const cells = strategies
      .map((s) => `${pct(r.byKind[kind][s].r1)} / ${f2(r.byKind[kind][s].mrr)}`.padStart(13))
      .join("");
    console.log(`${kind.padEnd(12)}${cells}`);
  }
  console.log("─".repeat(52));
  console.log(`hybrid weight sweep (keyword weight → MRR), best = ${f2(r.hybridWeight)}:`);
  console.log(
    r.sweep.map((s) => `${f2(s.weight)}:${f2(s.mrr)}${s.weight === r.hybridWeight ? "*" : " "}`).join("  "),
  );
  console.log("─".repeat(52));
  console.log("quality gate:");
  for (const row of r.gate) {
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name}: ${pct(row.value)} (floor ${pct(row.floor)})`);
  }
  console.log("─".repeat(52));
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
