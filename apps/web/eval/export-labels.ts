/**
 * Build a BLIND audit sheet so a human can check whether the LLM judges are any good.
 *
 * Why this exists. The generation numbers — faithfulness 98%, relevance 100%, citations 100% —
 * are produced by models grading a model. Nothing has ever verified the graders. "98%
 * faithfulness" currently means "bespoke-minicheck said 98% of claims were supported", and if
 * minicheck is lenient the true figure could be far lower with nothing in the harness noticing.
 * Three scores of exactly 100% are precisely what a rubber-stamping grader produces.
 *
 * Two files are written, and the separation is the point:
 *
 *   judge-labels.csv       the sheet you fill in. It does NOT contain the judge's verdict.
 *   judge-labels.key.json  the judge's verdicts, keyed by row id. Do not read it while labelling.
 *
 * Showing the judge's answer next to the question would anchor the labeller to it, and the
 * agreement figure that came out would measure suggestibility rather than judge quality.
 *
 * Sampling is stratified and deterministic (fixed seed): every verdict the judge marked
 * unsupported or refused is included, because disagreements carry nearly all the information,
 * plus a sample of the majority "supported" class so agreement is not computed only on hard cases.
 *
 * Run: pnpm --filter @indexflow/web judge:export   [LABEL_SAMPLE=40]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { RagItem, RagReport } from "./rag-harness";

const OUT_DIR = process.env.EVAL_RUN_DIR ?? new URL("../../../.evalrun", import.meta.url).pathname;
const REPORT = `${OUT_DIR}/rag-report.json`;
const SHEET = `${OUT_DIR}/judge-labels.csv`;
const KEY = `${OUT_DIR}/judge-labels.key.json`;

/** Rows to aim for. Every informative (minority-class) row is kept regardless of this. */
const TARGET = Number(process.env.LABEL_SAMPLE ?? 40);

type RowType = "faithfulness" | "refusal" | "relevance" | "citation";

interface Row {
  id: string;
  type: RowType;
  question: string;
  /** The claim (faithfulness) or the whole answer (refusal / relevance) being judged. */
  subject: string;
  passages: string;
  /** What you are being asked to decide, in plain language. */
  question_for_you: string;
}

interface KeyEntry {
  id: string;
  type: RowType;
  judgeVerdict: "yes" | "no";
  judgeScore?: number;
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""').replace(/\r?\n/g, "\n")}"`;

/** Deterministic shuffle (mulberry32), so re-exporting produces the same sheet. */
function shuffled<T>(items: T[], seed = 0x5eed): T[] {
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function build(items: RagItem[]): { rows: Row[]; key: KeyEntry[] } {
  const informative: Row[] = [];
  const majority: Row[] = [];
  const key: KeyEntry[] = [];

  const push = (row: Row, verdict: "yes" | "no", isMinority: boolean, judgeScore?: number) => {
    (isMinority ? informative : majority).push(row);
    key.push({ id: row.id, type: row.type, judgeVerdict: verdict, judgeScore });
  };

  let n = 0;
  for (const item of items) {
    if (item.error) continue;
    const passages = (item.contextText ?? "").trim();

    if (item.answerable) {
      // Qwen's two headline 100% scores are answer-level judgments. Convert the continuous
      // 0..1 scores into a binary "fully correct?" audit target: a score below 1 means the judge
      // itself found some defect, so that row is informative and always kept.
      push(
        {
          id: `v${++n}`,
          type: "relevance",
          question: item.q,
          subject: item.answer,
          passages,
          question_for_you:
            "Does this answer directly and completely address the question using only the passages above? " +
            "Answer yes only if it is relevant; answer no if it dodges, omits the core answer, or relies on unsupported context.",
        },
        item.judge.answer_relevance >= 0.999 ? "yes" : "no",
        item.judge.answer_relevance < 0.999,
        item.judge.answer_relevance,
      );

      push(
        {
          id: `c${++n}`,
          type: "citation",
          question: item.q,
          subject: item.answer,
          passages,
          question_for_you:
            "Are the answer's citations correct? Answer yes only if every cited factual claim is supported " +
            "by the cited passage(s). Answer no for missing, wrong, or unsupported citations.",
        },
        item.judge.citation_correctness >= 0.999 ? "yes" : "no",
        item.judge.citation_correctness < 0.999,
        item.judge.citation_correctness,
      );

      // One row per claim: this is the level minicheck actually judges at.
      for (const claim of item.claims ?? []) {
        const unsupported = (item.judge.unsupported_claims ?? []).includes(claim);
        push(
          {
            id: `f${++n}`,
            type: "faithfulness",
            question: item.q,
            subject: claim,
            passages,
            question_for_you:
              "Is this claim fully supported by the passages above? Answer yes or no. " +
              "Answer no if any part of it is not stated there, even if it is true in general.",
          },
          unsupported ? "no" : "yes",
          unsupported, // unsupported is the rare class
          unsupported ? 0 : 1,
        );
      }
    } else {
      // Unanswerable questions: the judge decides whether the model correctly refused.
      push(
        {
          id: `r${++n}`,
          type: "refusal",
          question: item.q,
          subject: item.answer,
          passages,
          question_for_you:
            "The passages above do NOT answer the question. Did the model correctly decline to " +
            "answer, rather than inventing one? Answer yes if it declined, no if it answered anyway.",
        },
        item.judge.refused ? "yes" : "no",
        !item.judge.refused, // failing to refuse is the rare class
        item.judge.refused ? 1 : 0,
      );
    }
  }

  // Keep every informative row; top up with a deterministic sample of the majority class.
  const room = Math.max(0, TARGET - informative.length);
  const rows = [...informative, ...shuffled(majority).slice(0, room)];
  const keptIds = new Set(rows.map((r) => r.id));

  return {
    // Shuffle again so the minority rows are not all clustered at the top, which would itself
    // be a hint about which items the judge found difficult.
    rows: shuffled(rows, 0xc0ffee),
    key: key.filter((k) => keptIds.has(k.id)),
  };
}

function main() {
  let report: RagReport & { generatedAt?: string };
  try {
    report = JSON.parse(readFileSync(REPORT, "utf8"));
  } catch {
    console.error(`No saved run at ${REPORT}.`);
    console.error("Run the generation eval first: pnpm --filter @indexflow/web eval:rag");
    console.error("(EVAL_LIMIT=6 gives a quick subset if you only want to try the workflow.)");
    process.exit(1);
  }

  const { rows, key } = build(report.items ?? []);
  if (rows.length === 0) {
    console.error("The saved run contains no gradable items.");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const header = ["id", "type", "question", "being_judged", "passages", "what_to_decide", "your_verdict"];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      [r.id, r.type, r.question, r.subject, r.passages, r.question_for_you, ""].map(csvCell).join(","),
    ),
  ].join("\n");
  writeFileSync(SHEET, csv + "\n");
  writeFileSync(KEY, JSON.stringify({ generatedAt: new Date().toISOString(), key }, null, 2));

  const minority = key.filter((k) => k.judgeVerdict === "no").length;
  console.log(`\nBlind audit sheet: ${SHEET}`);
  console.log(`Answer key (do NOT open until you are done): ${KEY}`);
  console.log(`\n${rows.length} rows — ${minority} where the judge said no, ${rows.length - minority} where it said yes.`);
  console.log("(The sheet is shuffled and does not reveal which is which.)");
  console.log("\nHow to fill it in:");
  console.log("  1. Open the CSV in a spreadsheet (Numbers, Excel, Sheets).");
  console.log("  2. Read `passages`, then `being_judged`, then `what_to_decide`.");
  console.log("  3. Put yes or no in `your_verdict`. Leave a row blank to skip it.");
  console.log("  4. Save as CSV, same path.");
  console.log("\nThen: pnpm --filter @indexflow/web judge:calibrate");
}

main();
