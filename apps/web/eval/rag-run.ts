/**
 * CLI for the generation (RAG) evaluation. Runs the real retriever + local generation +
 * local LLM-judges over the labeled Q&A set and prints faithfulness / relevance / citation /
 * refusal numbers with a pass/fail gate. Exits non-zero if the gate fails.
 *
 * Needs a running Ollama with the three models pulled (see README) — no API keys. It is slow
 * (models are loaded one at a time; see rag-harness.ts), so it is NOT wired into CI.
 * Run: pnpm --filter @indexflow/web eval:rag   [EVAL_LIMIT=6 for a quick subset]
 */
import { mkdirSync, writeFileSync } from "node:fs";
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

  // Errored items score 0 and would otherwise be indistinguishable from a genuinely bad
  // answer — surface them separately so an infra failure never reads as a quality result.
  const errored = r.items.filter((i) => i.error);
  if (errored.length) {
    console.log(`errored items (scored 0, NOT a quality signal) — ${errored.length}/${r.items.length}:`);
    for (const e of errored) {
      console.log(`  • ${e.q}`);
      console.log(`      ${e.judge.reasoning}`);
    }
    console.log("─".repeat(56));
  }

  const misses = r.items.filter(
    (i) => !i.error &&
      ((i.answerable && (i.judge.faithfulness < 1 || i.judge.unsupported_claims.length > 0)) ||
        (!i.answerable && !i.judge.refused)),
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

/**
 * Persist the full report. The generation eval takes ~30 minutes, so anything that wants to
 * inspect its output afterwards — the judge-calibration export, in particular — must be able to
 * read a saved run rather than trigger another one.
 */
function persist(report: RagReport) {
  const dir = process.env.EVAL_RUN_DIR ?? new URL("../../../.evalrun", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/rag-report.json`;
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
  console.log(`\nfull report saved to ${path}`);
  console.log("→ build a blind audit sheet from it with: pnpm --filter @indexflow/web judge:export");
}

runRagEvaluation()
  .then(async (report) => {
    print(report);
    persist(report);
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
