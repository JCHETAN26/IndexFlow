/**
 * Export rankings in TREC format so an external reference implementation can score them.
 *
 * Phase 1a of the evaluation hardening: `recallAt` / `mrr` / `precisionAt` / `ndcgAt` are
 * from-scratch and gate CI, so they are cross-checked against `pytrec_eval` — the Python binding
 * to NIST's `trec_eval`, which is the reference every IR paper scores against.
 *
 * This emits three files into a target directory:
 *
 *   qrels.txt        `qid 0 docid relevance`        — the labels
 *   <ranker>.run     `qid Q0 docid rank score tag`  — one per synthetic ranker
 *   harness.json     what our own metric code computes for the same rankings
 *
 * `eval/crosscheck.py` reads all three and reports the delta. Deliberately no database and no
 * Elasticsearch: the point is to validate the *instrument*, so the rankings are synthetic ones
 * whose scores are known on paper. The real retrieval run is exported by the same writer once it
 * has services to run against.
 *
 * Run: pnpm --filter @indexflow/web eval:trec-export
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mrr, ndcgAt, precisionAt, ranksForQuery, recallAt, type Labeled } from "./metrics";
import corpus from "./corpus.json";
import queries from "./queries.json";

const OUT_DIR = process.env.TREC_OUT ?? join(process.cwd(), ".evalrun", "trec");

const DOCS: string[] = corpus.map((d) => d.fileName);
const N = DOCS.length;

interface Row extends Labeled {
  qid: string;
}

const testRows: Row[] = queries
  .filter((q) => (q as { split?: string }).split !== "tune")
  .map((q, i) => ({ qid: `q${i + 1}`, relevant: q.relevant }));

// ── the same synthetic rankers the unit suite asserts against ─────────────
const oracle = (row: Row): string[] => [
  ...row.relevant,
  ...DOCS.filter((d) => !row.relevant.includes(d)),
];

const reversed = (row: Row): string[] => [
  ...DOCS.filter((d) => !row.relevant.includes(d)),
  ...row.relevant,
];

function shuffled(seed: number): string[] {
  let s = seed + 0x9e3779b9;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...DOCS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A deliberately imperfect ranker. Oracle and reversed sit at the extremes where several
 * conventions coincide; a mid-range ranker with relevant documents scattered across ranks 1–17 is
 * what actually discriminates between nDCG conventions.
 */
const scattered = (row: Row): string[] => {
  const order = shuffled(row.relevant.length + row.qid.length * 31);
  const rest = order.filter((d) => !row.relevant.includes(d));
  const out = [...rest];
  // Insert each relevant document at a fixed, uneven depth rather than at the top.
  row.relevant.forEach((d, i) => out.splice(Math.min(2 + i * 4, out.length), 0, d));
  return out;
};

const RANKERS: Record<string, (row: Row) => string[]> = {
  oracle,
  reversed,
  random: (row) => shuffled(row.relevant.length * 7919),
  scattered,
};

// ── writers ───────────────────────────────────────────────────────────────
/**
 * TREC qrels. A query with no relevant documents gets no line at all — it cannot have one, since
 * the format records relevance judgements and there is nothing to judge. That asymmetry is the
 * whole reason our numbers and the reference's are expected to differ by judged/total.
 */
function qrels(rows: Row[]): string {
  const lines: string[] = [];
  for (const r of rows) for (const d of r.relevant) lines.push(`${r.qid} 0 ${d} 1`);
  return lines.join("\n") + "\n";
}

function runFile(rows: Row[], rank: (row: Row) => string[], tag: string): string {
  const lines: string[] = [];
  for (const r of rows) {
    rank(r).forEach((doc, i) => {
      // Score must decrease with rank; trec_eval re-sorts by score, not by the rank column.
      lines.push(`${r.qid} Q0 ${doc} ${i + 1} ${(N - i).toFixed(4)} ${tag}`);
    });
  }
  return lines.join("\n") + "\n";
}

function harnessMetrics(rows: Row[], rank: (row: Row) => string[]) {
  const ranks = rows.map((r) => ranksForQuery(rank(r), r.relevant));
  return {
    recip_rank: mrr(ranks),
    recall_1: recallAt(ranks, rows, 1),
    recall_3: recallAt(ranks, rows, 3),
    recall_5: recallAt(ranks, rows, 5),
    P_3: precisionAt(ranks, 3),
    ndcg_cut_5: ndcgAt(ranks, rows, 5),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "qrels.txt"), qrels(testRows));

const harness: Record<string, Record<string, number>> = {};
for (const [name, rank] of Object.entries(RANKERS)) {
  writeFileSync(join(OUT_DIR, `${name}.run`), runFile(testRows, rank, name));
  harness[name] = harnessMetrics(testRows, rank);
}

const judged = testRows.filter((r) => r.relevant.length > 0).length;
writeFileSync(
  join(OUT_DIR, "harness.json"),
  JSON.stringify(
    {
      numQueries: testRows.length,
      numJudged: judged,
      numDocs: N,
      // The correction the cross-check expects to have to apply, stated up front so the Python
      // side cannot be accused of fitting a factor after seeing the residual.
      predictedScale: judged / testRows.length,
      metrics: harness,
    },
    null,
    2,
  ) + "\n",
);

console.log(`wrote TREC export to ${OUT_DIR}`);
console.log(`  queries: ${testRows.length} (${judged} judged), docs: ${N}`);
console.log(`  rankers: ${Object.keys(RANKERS).join(", ")}`);
console.log(`  predicted harness/reference scale: ${judged}/${testRows.length} = ${(judged / testRows.length).toFixed(6)}`);
