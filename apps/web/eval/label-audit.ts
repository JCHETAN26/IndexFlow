/**
 * Phase 6: audit the relevance labels themselves.
 *
 * The LLM judges were calibrated against a blind human (`judge:calibrate`). The **relevance
 * labels have never been.** Every retrieval number in this repository — every MRR, every recall,
 * every ceiling — rests on one person's unaudited opinion about which document answers which
 * query. If those labels are wrong, the instrument is calibrated against a bent ruler.
 *
 * Two failure modes, and they are not symmetric:
 *
 *   Over-labelling  a document marked relevant that is not. Inflates every strategy's score.
 *   Under-labelling a relevant document left unmarked. **Silently deflates recall for every
 *                   strategy equally**, which makes it invisible in any comparison between
 *                   strategies while making the absolute numbers wrong. This is the dangerous one,
 *                   and it is why the sample below is half negatives.
 *
 * Negatives are not drawn at random — a random unlabelled document is obviously irrelevant and
 * tests nothing. They are the highest lexical-overlap documents that the labels call irrelevant:
 * the plausible near-misses where under-labelling actually hides.
 *
 *   pnpm --filter @indexflow/web labels:export   → label-audit.csv (blind) + .key.json
 *   pnpm --filter @indexflow/web labels:score    → agreement + Cohen's kappa
 *
 * Do not read the key file while labelling. That is the whole point of it being separate.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import corpus from "./corpus.json";
import queries from "./queries.json";

const OUT_DIR = process.env.EVAL_RUN_DIR ?? join(process.cwd(), ".evalrun");
const SHEET = join(OUT_DIR, "label-audit.csv");
const KEY = join(OUT_DIR, "label-audit.key.json");
const SAMPLE_SIZE = Number(process.env.LABEL_AUDIT_N ?? 20);

type Truth = "relevant" | "irrelevant";
interface KeyEntry {
  id: string;
  query: string;
  fileName: string;
  labelled: Truth;
  /** How the pair was chosen, so the report can separate the two error modes. */
  kind: "positive" | "hard-negative";
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

function shuffled<T>(items: T[], seed = 0x5eed): T[] {
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── lexical scoring, to find plausible negatives without standing up services ──
const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);

function buildIdf(): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of corpus) {
    for (const w of new Set(tokenize(`${d.title} ${d.content}`))) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [w, n] of df) idf.set(w, Math.log(corpus.length / (1 + n)) + 1);
  return idf;
}

function overlapScore(query: string, doc: { title: string; content: string }, idf: Map<string, number>): number {
  const docTerms = new Set(tokenize(`${doc.title} ${doc.content}`));
  let score = 0;
  for (const w of new Set(tokenize(query))) if (docTerms.has(w)) score += idf.get(w) ?? 0;
  return score;
}

function doExport() {
  const idf = buildIdf();
  const answerable = queries.filter((q) => q.relevant.length > 0);

  const positives: KeyEntry[] = [];
  const negatives: KeyEntry[] = [];

  for (const q of shuffled(answerable, 0xa11ce)) {
    // One positive: a document the labels call relevant.
    if (positives.length < Math.floor(SAMPLE_SIZE / 2)) {
      const f = q.relevant[0];
      const doc = corpus.find((d) => d.fileName === f);
      if (doc) {
        positives.push({
          id: `p${positives.length + 1}`,
          query: q.q,
          fileName: doc.fileName,
          labelled: "relevant",
          kind: "positive",
        });
      }
    }
    // One hard negative: the highest-overlap document the labels call irrelevant. Multi-relevant
    // queries are the most informative here — if a query has two labelled documents and a third
    // scores nearly as well, that third is exactly where under-labelling hides.
    if (negatives.length < Math.ceil(SAMPLE_SIZE / 2)) {
      const best = corpus
        .filter((d) => !q.relevant.includes(d.fileName))
        .map((d) => ({ d, s: overlapScore(q.q, d, idf) }))
        .sort((a, b) => b.s - a.s)[0];
      if (best && best.s > 0) {
        negatives.push({
          id: `n${negatives.length + 1}`,
          query: q.q,
          fileName: best.d.fileName,
          labelled: "irrelevant",
          kind: "hard-negative",
        });
      }
    }
    if (positives.length + negatives.length >= SAMPLE_SIZE) break;
  }

  const key = shuffled([...positives, ...negatives], 0xc0ffee).map((k, i) => ({
    ...k,
    id: `r${String(i + 1).padStart(2, "0")}`,
  }));

  const contentOf = (f: string) => corpus.find((d) => d.fileName === f)?.content ?? "";
  const titleOf = (f: string) => corpus.find((d) => d.fileName === f)?.title ?? f;

  mkdirSync(OUT_DIR, { recursive: true });
  const csv = [
    ["id", "query", "document_title", "document_text", "your_verdict_y_n_unsure", "note"].join(","),
    ...key.map((k) =>
      [k.id, k.query, titleOf(k.fileName), contentOf(k.fileName), "", ""].map(csvCell).join(","),
    ),
  ].join("\n");
  writeFileSync(SHEET, csv + "\n");
  writeFileSync(
    KEY,
    JSON.stringify({ generated: new Date().toISOString(), sampleSize: key.length, key }, null, 2) + "\n",
  );

  console.log(`\nWrote ${key.length} pairs to audit:`);
  console.log(`  sheet: ${SHEET}`);
  console.log(`  key:   ${KEY}   <- do NOT open this while labelling`);
  console.log(`\nComposition: ${key.filter((k) => k.kind === "positive").length} currently-labelled-relevant, ` +
    `${key.filter((k) => k.kind === "hard-negative").length} highest-overlap currently-labelled-irrelevant.`);
  console.log(`\nFor each row answer: does this document answer this query?`);
  console.log(`  y       yes, it answers the query`);
  console.log(`  n       no, it does not`);
  console.log(`  unsure  genuinely ambiguous — these are REPORTED, not forced into a bucket`);
  console.log(`\nThen: pnpm --filter @indexflow/web labels:score`);
}

// ── scoring ───────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** Cohen's kappa on a binary label. Agreement alone is not enough when classes are unbalanced. */
function cohensKappa(pairs: { a: boolean; b: boolean }[]): number {
  const n = pairs.length;
  if (n === 0) return 0;
  const observed = pairs.filter((p) => p.a === p.b).length / n;
  const aTrue = pairs.filter((p) => p.a).length / n;
  const bTrue = pairs.filter((p) => p.b).length / n;
  const expected = aTrue * bTrue + (1 - aTrue) * (1 - bTrue);
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

const interpret = (k: number): string =>
  k < 0 ? "worse than chance" :
  k < 0.2 ? "slight — the labels are not trustworthy as they stand" :
  k < 0.4 ? "fair — material disagreement, investigate before publishing" :
  k < 0.6 ? "moderate" :
  k < 0.8 ? "substantial — publishable with the kappa alongside" :
  "almost perfect";

function doScore() {
  const sheet = parseCsv(readFileSync(SHEET, "utf8"));
  const key = new Map<string, KeyEntry>(
    (JSON.parse(readFileSync(KEY, "utf8")).key as KeyEntry[]).map((k) => [k.id, k]),
  );
  const header = sheet[0].map((h) => h.trim());
  const idCol = header.indexOf("id");
  const verdictCol = header.indexOf("your_verdict_y_n_unsure");
  const noteCol = header.indexOf("note");

  const pairs: { id: string; human: boolean; labelled: boolean; kind: KeyEntry["kind"]; query: string; file: string }[] = [];
  const unsure: { id: string; query: string; file: string; note: string }[] = [];
  let blank = 0;

  for (const row of sheet.slice(1)) {
    const id = row[idCol]?.trim();
    const k = key.get(id);
    if (!k) continue;
    const v = (row[verdictCol] ?? "").trim().toLowerCase();
    if (v === "") { blank++; continue; }
    if (v.startsWith("u")) {
      unsure.push({ id, query: k.query, file: k.fileName, note: (row[noteCol] ?? "").trim() });
      continue;
    }
    pairs.push({
      id,
      human: v.startsWith("y"),
      labelled: k.labelled === "relevant",
      kind: k.kind,
      query: k.query,
      file: k.fileName,
    });
  }

  console.log(`\nLabel audit — ${pairs.length} scored, ${unsure.length} unsure, ${blank} unfilled\n`);
  if (pairs.length === 0) {
    console.log("Nothing scored. Fill the your_verdict column in the CSV first.");
    return;
  }

  const agree = pairs.filter((p) => p.human === p.labelled).length;
  const kappa = cohensKappa(pairs.map((p) => ({ a: p.human, b: p.labelled })));
  console.log(`  raw agreement  ${((agree / pairs.length) * 100).toFixed(0)}%  (${agree}/${pairs.length})`);
  console.log(`  Cohen's κ      ${kappa.toFixed(2)}  — ${interpret(kappa)}\n`);

  // The two error directions mean different things and must not be pooled.
  const over = pairs.filter((p) => p.labelled && !p.human);
  const under = pairs.filter((p) => !p.labelled && p.human);
  console.log(`  OVER-labelled  ${over.length}: marked relevant, human says no.`);
  console.log(`                 Inflates every strategy's score.`);
  for (const p of over) console.log(`    ${p.id}  "${p.query}" -> ${p.file}`);
  console.log(`  UNDER-labelled ${under.length}: marked irrelevant, human says yes.`);
  console.log(`                 Deflates recall for every strategy EQUALLY — invisible in any`);
  console.log(`                 comparison between strategies, but the absolute numbers are wrong.`);
  for (const p of under) console.log(`    ${p.id}  "${p.query}" -> ${p.file}`);

  if (unsure.length > 0) {
    console.log(`\n  AMBIGUOUS ${unsure.length} — flagged for review, not resolved here:`);
    for (const u of unsure) console.log(`    ${u.id}  "${u.query}" -> ${u.file}${u.note ? `  (${u.note})` : ""}`);
  }

  const underRate = under.length / Math.max(1, pairs.filter((p) => !p.labelled).length);
  console.log(`\n  Under-labelling rate among hard negatives: ${(underRate * 100).toFixed(0)}%`);
  if (under.length > 0) {
    console.log(
      `  If this rate holds corpus-wide, every recall and nDCG figure in RESULTS.md is an\n` +
        `  UNDERSTATEMENT, because relevant documents are being scored as misses.`,
    );
  }
  if (pairs.length < 20) {
    console.log(`\n  NOTE: ${pairs.length} items. Kappa is unstable below about 20 — read this as directional.`);
  }
}

const mode = process.argv[2] ?? process.env.LABEL_AUDIT_MODE ?? "export";
if (mode === "score") doScore();
else doExport();
