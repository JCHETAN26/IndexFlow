/**
 * Score the filled-in audit sheet against what the LLM judges actually said.
 *
 * Reports raw agreement and Cohen's kappa. Kappa matters more than agreement here: a judge that
 * marks everything "supported" agrees with a human on a set that is 95% supported 95% of the
 * time, which sounds excellent and means nothing. Kappa subtracts the agreement you would expect
 * from chance given each rater's base rates, so a rubber stamp scores near zero however high its
 * raw agreement.
 *
 * Also breaks the disagreements into the two directions, because they mean different things:
 *   - judge said supported, human said not  → LENIENT. Inflates the published faithfulness score.
 *   - judge said not supported, human said  → STRICT. Understates it. Less dangerous.
 *
 * Run: pnpm --filter @indexflow/web judge:calibrate
 */
import { readFileSync } from "node:fs";

const OUT_DIR = process.env.EVAL_RUN_DIR ?? new URL("../../../.evalrun", import.meta.url).pathname;
const SHEET = `${OUT_DIR}/judge-labels.csv`;
const KEY = `${OUT_DIR}/judge-labels.key.json`;

type Verdict = "yes" | "no";
type RowType = "faithfulness" | "refusal" | "relevance" | "citation";

/** Minimal RFC4180 CSV reader — the passages contain commas, quotes and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function normalise(v: string): Verdict | null {
  const s = v.trim().toLowerCase();
  if (["y", "yes", "true", "1", "supported", "correct"].includes(s)) return "yes";
  if (["n", "no", "false", "0", "unsupported", "incorrect"].includes(s)) return "no";
  return null;
}

/**
 * Cohen's kappa for two raters on a binary label.
 * (observed - expected) / (1 - expected), where expected comes from the raters' marginals.
 */
function cohensKappa(pairs: { a: Verdict; b: Verdict }[]): number {
  const n = pairs.length;
  if (n === 0) return 0;
  const agree = pairs.filter((p) => p.a === p.b).length / n;
  const aYes = pairs.filter((p) => p.a === "yes").length / n;
  const bYes = pairs.filter((p) => p.b === "yes").length / n;
  const expected = aYes * bYes + (1 - aYes) * (1 - bYes);
  if (expected === 1) return agree === 1 ? 1 : 0; // degenerate: one rater never varied
  return (agree - expected) / (1 - expected);
}

/** Landis & Koch, the conventional reading of kappa. */
function interpret(k: number): string {
  if (k < 0) return "worse than chance";
  if (k < 0.2) return "slight — the judge is close to a rubber stamp";
  if (k < 0.4) return "fair — not trustworthy on its own";
  if (k < 0.6) return "moderate — usable with caveats";
  if (k < 0.8) return "substantial — reasonable to publish with the kappa alongside";
  return "almost perfect";
}

function main() {
  let sheet: string;
  let keyRaw: string;
  try {
    sheet = readFileSync(SHEET, "utf8");
    keyRaw = readFileSync(KEY, "utf8");
  } catch {
    console.error(`Missing ${SHEET} or ${KEY}.`);
    console.error("Build them first: pnpm --filter @indexflow/web judge:export");
    process.exit(1);
  }

  const key = new Map<string, { type: RowType; judgeVerdict: Verdict }>(
    (JSON.parse(keyRaw).key as { id: string; type: RowType; judgeVerdict: Verdict; judgeScore?: number }[]).map((k) => [
      k.id,
      { type: k.type, judgeVerdict: k.judgeVerdict },
    ]),
  );

  const rows = parseCsv(sheet);
  const header = rows[0].map((h) => h.trim());
  const idIdx = header.indexOf("id");
  const verdictIdx = header.indexOf("your_verdict");
  if (idIdx === -1 || verdictIdx === -1) {
    console.error("The sheet must keep its `id` and `your_verdict` columns.");
    process.exit(1);
  }

  const pairs: { id: string; type: RowType; human: Verdict; judge: Verdict }[] = [];
  let blank = 0;
  let unreadable = 0;

  for (const r of rows.slice(1)) {
    const id = r[idIdx]?.trim();
    const entry = key.get(id);
    if (!entry) continue;
    const raw = r[verdictIdx] ?? "";
    if (raw.trim() === "") {
      blank++;
      continue;
    }
    const human = normalise(raw);
    if (!human) {
      unreadable++;
      console.warn(`  ignoring row ${id}: "${raw.trim()}" is not yes or no`);
      continue;
    }
    pairs.push({ id, type: entry.type, human, judge: entry.judgeVerdict });
  }

  console.log(`\nJudge calibration — ${pairs.length} labelled of ${key.size} rows` +
    (blank ? ` (${blank} left blank)` : "") + (unreadable ? `, ${unreadable} unreadable` : ""));
  console.log("─".repeat(72));

  if (pairs.length === 0) {
    console.error("Nothing labelled yet. Fill in the `your_verdict` column and re-run.");
    process.exit(1);
  }
  if (pairs.length < 20) {
    console.log(`NOTE: ${pairs.length} labels is a small audit. Treat the numbers below as`);
    console.log("      directional; kappa is unstable under about 20 items.\n");
  }

  const report = (label: string, subset: typeof pairs) => {
    if (subset.length === 0) return;
    const agree = subset.filter((p) => p.human === p.judge).length;
    const lenient = subset.filter((p) => p.judge === "yes" && p.human === "no");
    const strict = subset.filter((p) => p.judge === "no" && p.human === "yes");
    const kappa = cohensKappa(subset.map((p) => ({ a: p.human, b: p.judge })));

    console.log(`${label} (${subset.length} items)`);
    console.log(`  agreement    ${((agree / subset.length) * 100).toFixed(0)}%  (${agree}/${subset.length})`);
    console.log(`  Cohen's κ    ${kappa.toFixed(2)}  — ${interpret(kappa)}`);
    console.log(`  judge too LENIENT  ${lenient.length}  (it passed something you rejected → inflates the score)`);
    console.log(`  judge too STRICT   ${strict.length}  (it rejected something you accepted → understates it)`);
    if (lenient.length) console.log(`    lenient rows: ${lenient.map((p) => p.id).join(", ")}`);
    if (strict.length) console.log(`    strict rows:  ${strict.map((p) => p.id).join(", ")}`);
    console.log("");
  };

  report("OVERALL", pairs);
  report("faithfulness (bespoke-minicheck)", pairs.filter((p) => p.type === "faithfulness"));
  report("answer relevance (qwen2.5)", pairs.filter((p) => p.type === "relevance"));
  report("citation correctness (qwen2.5)", pairs.filter((p) => p.type === "citation"));
  report("refusal (qwen2.5)", pairs.filter((p) => p.type === "refusal"));

  const overallKappa = cohensKappa(pairs.map((p) => ({ a: p.human, b: p.judge })));
  console.log("─".repeat(72));
  console.log("What to do with this:");
  if (overallKappa >= 0.6) {
    console.log("  Agreement is good enough to publish the generation metrics WITH this kappa");
    console.log("  quoted next to them. The numbers stop being an assertion and become evidence.");
  } else {
    console.log("  Agreement is too weak to publish the generation metrics as-is. They measure");
    console.log("  what the judge thinks, and the judge does not reliably match you. Either say so");
    console.log("  plainly next to the numbers, or change the judge (bigger model, better prompt)");
    console.log("  and re-audit. This is a finding, not a failure.");
  }
  console.log(`\nRecord the result in eval/RESULTS.md next to the generation numbers.`);
}

main();
