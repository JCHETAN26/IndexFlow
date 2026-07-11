/**
 * CLI for the generation (RAG) evaluation. Runs the real retriever + Claude + LLM-judge
 * over the labeled Q&A set and prints faithfulness / relevance / citation / refusal
 * numbers with a pass/fail gate. Exits non-zero if the gate fails.
 *
 * Requires ANTHROPIC_API_KEY (it makes real API calls, so it is NOT wired into CI).
 * Run: pnpm --filter @indexflow/web eval:rag
 */
import { prisma } from "../lib/prisma";
import { runRagEvaluation, type RagReport } from "./rag-harness";

const pct = (n: number) => (n * 100).toFixed(0).padStart(3) + "%";

function print(r: RagReport) {
  console.log(`\nGeneration eval — ${r.numAnswerable} answerable + ${r.numUnanswerable} unanswerable, k=${r.ragK}`);
  console.log(`gen: ${r.genModel}   judge: ${r.judgeModel}${r.selfJudged ? "  (self-judged — see caveat)" : ""}`);
  console.log("─".repeat(56));
  console.log(`faithfulness (answerable)          ${pct(r.faithfulness)}`);
  console.log(`answer relevance (answerable)      ${pct(r.answerRelevance)}`);
  console.log(`citation correctness (answerable)  ${pct(r.citationCorrectness)}`);
  console.log(`context recall (answerable)        ${pct(r.contextRecall)}`);
  console.log(`refusal correctness (unanswerable) ${pct(r.refusalCorrectness)}`);
  console.log("─".repeat(56));
  console.log("quality gate:");
  for (const row of r.gate) {
    console.log(`  ${row.pass ? "PASS" : "FAIL"}  ${row.name}: ${pct(row.value)} (floor ${pct(row.floor)})`);
  }
  console.log("─".repeat(56));

  const misses = r.items.filter(
    (i) => (i.answerable && (i.judge.faithfulness < 1 || i.judge.unsupported_claims.length > 0)) ||
      (!i.answerable && !i.judge.refused),
  );
  if (misses.length) {
    console.log("flagged answers:");
    for (const m of misses) {
      const tag = m.answerable ? `faith=${m.judge.faithfulness.toFixed(2)}` : "did NOT refuse";
      console.log(`  • [${tag}] ${m.q}`);
      if (m.judge.unsupported_claims.length) {
        console.log(`      unsupported: ${m.judge.unsupported_claims.join("; ")}`);
      }
    }
    console.log("─".repeat(56));
  }
}

runRagEvaluation()
  .then(async (report) => {
    print(report);
    await prisma.$disconnect();
    if (report.passed) {
      console.log("\nGeneration quality gate passed. ✓");
    } else {
      console.error("\nGeneration quality gate FAILED.");
      process.exitCode = 1;
    }
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
