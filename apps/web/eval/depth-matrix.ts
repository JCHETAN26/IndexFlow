/**
 * Phase 3 experiment: does the harness's asymmetric retrieval depth confound the published
 * "blending hurts" conclusion?
 *
 * Until now the harness retrieved the keyword leg at `chunks.length` and the semantic leg at
 * `LIMIT 10`. Because `blendHybrid` min-max normalises each leg independently, a deeper list has a
 * lower minimum and therefore has its top compressed toward 1.0 — depth changes how decisively a
 * leg votes, not just how many candidates it contributes. An asymmetry in depth is thus a
 * systematic thumb on the scale, in the same direction as hybrid's observed paraphrase deficit.
 *
 * Method: retrieve once at full depth and truncate. Retrieving at depth k returns exactly the
 * first k of a full-depth ranked list for both legs — ES returns BM25's top-k by score, and the
 * semantic leg is `ORDER BY ... LIMIT k` — so truncation reproduces a shallower retrieval exactly,
 * with no re-seeding and no re-embedding per cell.
 *
 * Everything here runs on the TUNING split. Depth is a configuration choice, and choosing it on
 * held-out data is the same error this project already retired once for the blend weight.
 *
 * Run: pnpm --filter @indexflow/web eval:depth
 */
import { prisma } from "../lib/prisma";
import { blendHybrid, type Scored } from "../lib/hybrid";
import { CANDIDATE_LIMIT } from "../lib/retrieve";
import { collectCandidates, LEGACY_DEPTHS } from "./harness";
import { dedupDocs, mrr, ndcgAt, ranksForQuery, recallAt } from "./metrics";

const f2 = (n: number) => n.toFixed(2);
const f3 = (n: number) => n.toFixed(3);
const pct = (n: number) => (n * 100).toFixed(0).padStart(3) + "%";

const SWEEP = Array.from({ length: 21 }, (_, i) => Number((i / 20).toFixed(2)));

interface Row {
  kind: "exact" | "paraphrase";
  split: "tune" | "test";
  relevant: string[];
  kw: { chunkId: string; docId: string; score: number }[];
  sm: { chunkId: string; docId: string; score: number }[];
}

/** Truncate both legs to a depth cell. Exactly equivalent to having retrieved at that depth. */
const atDepth = (r: Row, kw: number, sm: number): Row => ({
  ...r,
  kw: r.kw.slice(0, kw),
  sm: r.sm.slice(0, sm),
});

function hybridDocs(r: Row, weight: number): string[] {
  const toScored = (h: Row["kw"]): Scored[] => h.map((x) => ({ id: x.chunkId, score: x.score }));
  const chunkToDoc = new Map<string, string>();
  for (const h of [...r.kw, ...r.sm]) chunkToDoc.set(h.chunkId, h.docId);
  const blended = blendHybrid(toScored(r.kw), toScored(r.sm), weight);
  return dedupDocs(blended.map((b) => ({ docId: chunkToDoc.get(b.id)! })));
}

const ranksOf = (rows: Row[], weight: number) =>
  rows.map((r) => ranksForQuery(hybridDocs(r, weight), r.relevant));

/** Same balanced criterion the harness uses: mean of per-kind MRR, tie broken at plateau centre. */
function selectWeight(rows: Row[]): { weight: number; score: number } {
  const ex = rows.filter((r) => r.kind === "exact");
  const pa = rows.filter((r) => r.kind === "paraphrase");
  const balanced = (w: number) => {
    if (!ex.length || !pa.length) return mrr(ranksOf(rows, w), rows);
    return (mrr(ranksOf(ex, w), ex) + mrr(ranksOf(pa, w), pa)) / 2;
  };
  const sweep = SWEEP.map((w) => ({ w, s: balanced(w) }));
  const best = Math.max(...sweep.map((x) => x.s));
  const plateau = sweep.filter((x) => x.s >= best - 1e-9).map((x) => x.w);
  return { weight: plateau[Math.floor((plateau.length - 1) / 2)], score: best };
}

async function main() {
  // One retrieval pass at maximum depth. LEGACY_DEPTHS.keyword is MAX_SAFE_INTEGER, clamped to
  // corpus size inside collectCandidates, so both legs come back complete.
  const full = { keyword: Number.MAX_SAFE_INTEGER, semantic: Number.MAX_SAFE_INTEGER };
  const { evals, numChunks } = await collectCandidates(full);

  const rows = evals as unknown as Row[];
  const tune = rows.filter((r) => r.split === "tune");
  const test = rows.filter((r) => r.split === "test");

  console.log(`\nDepth matrix — ${rows.length} queries, ${numChunks} chunks in corpus`);
  console.log(`Tuning split: ${tune.length} queries (${tune.filter((r) => r.kind === "exact").length} exact / ${tune.filter((r) => r.kind === "paraphrase").length} paraphrase)`);
  console.log(
    `\nNOTE: the corpus holds ${numChunks} chunks, so every requested depth at or above ` +
      `${numChunks} is the same configuration. Cells are labelled with the depth ACTUALLY used.`,
  );

  const requested: { label: string; kw: number; sm: number }[] = [
    { label: "10 / 10", kw: 10, sm: 10 },
    { label: "50 / 50", kw: 50, sm: 50 },
    { label: "100 / 100", kw: 100, sm: 100 },
    { label: `all / 10 (legacy)`, kw: LEGACY_DEPTHS.keyword, sm: 10 },
    { label: `${CANDIDATE_LIMIT} / ${CANDIDATE_LIMIT} (production)`, kw: CANDIDATE_LIMIT, sm: CANDIDATE_LIMIT },
  ];

  const clamp = (n: number) => Math.min(n, numChunks);
  const seen = new Map<string, string>();

  console.log("\n" + "─".repeat(100));
  console.log(
    "cell".padEnd(28) +
      "effective".padEnd(12) +
      "weight".padEnd(9) +
      "MRR".padEnd(8) +
      "exact".padEnd(8) +
      "para".padEnd(8) +
      "R@1".padEnd(7) +
      "R@5".padEnd(7) +
      "nDCG@5",
  );
  console.log("─".repeat(100));

  for (const cell of requested) {
    const kw = clamp(cell.kw);
    const sm = clamp(cell.sm);
    const key = `${kw}/${sm}`;
    const dup = seen.get(key);
    seen.set(key, seen.get(key) ?? cell.label);

    const tuneAt = tune.map((r) => atDepth(r, kw, sm));
    const { weight } = selectWeight(tuneAt);
    const ex = tuneAt.filter((r) => r.kind === "exact");
    const pa = tuneAt.filter((r) => r.kind === "paraphrase");
    const ranks = ranksOf(tuneAt, weight);

    console.log(
      cell.label.padEnd(28) +
        key.padEnd(12) +
        f2(weight).padEnd(9) +
        f2(mrr(ranks, tuneAt)).padEnd(8) +
        f2(mrr(ranksOf(ex, weight), ex)).padEnd(8) +
        f2(mrr(ranksOf(pa, weight), pa)).padEnd(8) +
        pct(recallAt(ranks, tuneAt, 1)).padEnd(7) +
        pct(recallAt(ranks, tuneAt, 5)).padEnd(7) +
        pct(ndcgAt(ranks, tuneAt, 5)) +
        (dup ? `   [identical to "${dup}"]` : ""),
    );
  }
  console.log("─".repeat(100));

  // Single-leg baselines at full depth, for reference — these do not depend on the blend weight.
  const legRanks = (rowsAt: Row[], leg: "kw" | "sm") =>
    rowsAt.map((r) => ranksForQuery(dedupDocs(leg === "kw" ? r.kw : r.sm), r.relevant));
  console.log("single-leg baselines on the same tuning split (full depth):");
  for (const leg of ["kw", "sm"] as const) {
    const rk = legRanks(tune, leg);
    console.log(
      `  ${leg === "kw" ? "keyword " : "semantic"}  MRR ${f2(mrr(rk, tune))}   R@1 ${pct(recallAt(rk, tune, 1))}   R@5 ${pct(recallAt(rk, tune, 5))}`,
    );
  }
  console.log("─".repeat(100));

  // Score-distribution diagnostics: the mechanism, not just the outcome. If the top of a leg
  // compresses toward 1.0 as depth grows, it shows up here as a rising mean normalised score.
  console.log("normalisation diagnostics (tuning split, mean normalised score of each leg's rank-2 hit):");
  for (const [label, kw, sm] of [
    ["10 / 10", 10, 10],
    [`${clamp(999)} / ${clamp(999)}`, clamp(999), clamp(999)],
  ] as const) {
    const second = (leg: "kw" | "sm", depth: number) => {
      const vals: number[] = [];
      for (const r of tune) {
        const list = (leg === "kw" ? r.kw : r.sm).slice(0, depth);
        if (list.length < 2) continue;
        const scores = list.map((x) => x.score);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        if (max === min) continue;
        vals.push((scores[1] - min) / (max - min));
      }
      return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    };
    console.log(`  depth ${label.padEnd(10)} keyword ${f3(second("kw", kw))}   semantic ${f3(second("sm", sm))}`);
  }
  console.log("─".repeat(100));
  console.log(
    "\nHeld-out numbers are NOT printed here. The depth configuration is chosen on the tuning\n" +
      "split above; the held-out split is scored once, by `pnpm eval`, after that choice is fixed.\n" +
      `Held-out split held back: ${test.length} queries.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
