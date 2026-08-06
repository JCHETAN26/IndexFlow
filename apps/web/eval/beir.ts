/**
 * BEIR subset loader.
 *
 * BEIR (Thakur et al. 2021) is the standard zero-shot retrieval benchmark, and the reason to run
 * against it is that every in-house number so far has been self-referential: a correct harness on
 * a 17-document corpus answers a question nobody outside this repository asked. A published
 * baseline on a public corpus is the only measurement here that can be checked by a stranger.
 *
 * Two subsets, chosen because they fail in opposite directions:
 *
 *   scifact   5,183 docs / 300 test queries / binary relevance / ~1.1 relevant per query.
 *             Matches IndexFlow's task shape — find the one right document — at 305x the scale.
 *   nfcorpus  3,633 docs / 323 test queries / GRADED relevance (1 and 2) / ~38 relevant per query.
 *             Dense, graded labels make nDCG carry information MRR does not, and make ceiling
 *             saturation impossible.
 *
 * The archive is downloaded rather than committed (5,183 documents do not belong in git) and
 * verified against a pinned SHA256, so a silently changed upstream file fails loudly instead of
 * quietly moving every published number.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvalDataset, EvalDoc, EvalQuery, Split } from "./dataset";

const exec = promisify(execFile);

export interface BeirSpec {
  name: string;
  url: string;
  /** SHA256 of the archive. Pinned so the benchmark cannot move under us. */
  sha256: string;
  /** Which qrels file supplies the tuning split. SciFact ships train; NFCorpus ships dev. */
  tuneQrels: string;
}

export const BEIR_SUBSETS: Record<string, BeirSpec> = {
  scifact: {
    name: "scifact",
    url: "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip",
    sha256: "536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165",
    tuneQrels: "train",
  },
  "trec-covid": {
    name: "trec-covid",
    url: "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/trec-covid.zip",
    sha256: "120f42a7864d2214234537733c0d2c6684e42fdfafff2c5eacf98afca6656aa0",
    // Used only as a distractor pool for the Phase 9a scale curve — its own qrels are not scored.
    tuneQrels: "test",
  },
  nfcorpus: {
    name: "nfcorpus",
    url: "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/nfcorpus.zip",
    sha256: "efe5be03f8c5b86a5870102d0599d227c8c6e2484328e68c6522560385671b0b",
    // dev, not train. Train has 2,590 queries but binary-only judgments, while dev and test are
    // both graded — so tuning on dev selects the weight on data of the same character it is
    // scored on, avoiding the split-composition mismatch Phase 3 found in the in-domain set.
    tuneQrels: "dev",
  },
};

const CACHE_DIR = process.env.BEIR_CACHE ?? join(process.cwd(), ".evalrun", "beir");

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

/** Download and unpack a BEIR subset, verifying the archive hash. Cached between runs. */
export async function fetchSubset(spec: BeirSpec): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const zipPath = join(CACHE_DIR, `${spec.name}.zip`);
  const dir = join(CACHE_DIR, spec.name);

  if (!(await exists(zipPath))) {
    console.log(`[beir] downloading ${spec.name} from ${spec.url}`);
    const res = await fetch(spec.url);
    if (!res.ok || !res.body) throw new Error(`[beir] download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
  }

  const actual = await sha256File(zipPath);
  if (spec.sha256 && actual !== spec.sha256) {
    throw new Error(
      `[beir] ${spec.name} archive hash mismatch.\n` +
        `  expected ${spec.sha256}\n  actual   ${actual}\n` +
        `The upstream file changed. Do NOT update the pin without confirming why — every published ` +
        `number on this dataset would move.`,
    );
  }
  if (!spec.sha256) console.log(`[beir] WARNING: ${spec.name} has no pinned hash. Actual: ${actual}`);

  if (!(await exists(join(dir, "corpus.jsonl")))) {
    await exec("unzip", ["-oq", zipPath, "-d", CACHE_DIR]);
  }
  return dir;
}

const readJsonl = async <T>(path: string): Promise<T[]> =>
  (await readFile(path, "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);

/** TREC qrels TSV: `query-id<TAB>corpus-id<TAB>score`, with a header row. */
async function readQrels(path: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const [qid, docId, score] = line.split("\t");
    const gain = Number(score);
    if (!Number.isFinite(gain) || gain <= 0) continue;
    if (!out.has(qid)) out.set(qid, new Map());
    out.get(qid)!.set(docId, gain);
  }
  return out;
}

export interface LoadOptions {
  /** Cap the number of documents, for a faster smoke run. Relevant documents are always kept. */
  maxDocs?: number;
  /** Cap the number of test queries. */
  maxTestQueries?: number;
}

export async function loadBeir(subset: string, opts: LoadOptions = {}): Promise<EvalDataset> {
  const spec = BEIR_SUBSETS[subset];
  if (!spec) throw new Error(`[beir] unknown subset "${subset}"; have ${Object.keys(BEIR_SUBSETS)}`);
  const dir = await fetchSubset(spec);

  const rawDocs = await readJsonl<{ _id: string; title: string; text: string }>(
    join(dir, "corpus.jsonl"),
  );
  const rawQueries = await readJsonl<{ _id: string; text: string }>(join(dir, "queries.jsonl"));
  const testQrels = await readQrels(join(dir, "qrels", "test.tsv"));
  const tunePath = join(dir, "qrels", `${spec.tuneQrels}.tsv`);
  const tuneQrels = (await exists(tunePath)) ? await readQrels(tunePath) : new Map();

  const queryText = new Map(rawQueries.map((q) => [q._id, q.text]));

  let queries: EvalQuery[] = [];
  const push = (ids: Map<string, Map<string, number>>, split: Split) => {
    for (const [qid, rel] of ids) {
      const text = queryText.get(qid);
      if (!text) continue;
      queries.push({ id: qid, text, relevant: rel, split });
    }
  };
  push(tuneQrels, "tune");
  push(testQrels, "test");

  if (opts.maxTestQueries) {
    const tune = queries.filter((q) => q.split === "tune");
    const test = queries.filter((q) => q.split === "test").slice(0, opts.maxTestQueries);
    queries = [...tune, ...test];
  }

  // Keep every judged document, then fill up to maxDocs with unjudged ones. Dropping a relevant
  // document would silently cap recall and make the benchmark easier, which is the exact failure
  // this phase exists to escape.
  let docs: EvalDoc[] = rawDocs.map((d) => ({ id: d._id, title: d.title ?? "", content: d.text ?? "" }));
  if (opts.maxDocs && opts.maxDocs < docs.length) {
    const needed = new Set<string>();
    for (const q of queries) for (const id of q.relevant.keys()) needed.add(id);
    const judged = docs.filter((d) => needed.has(d.id));
    const filler = docs.filter((d) => !needed.has(d.id)).slice(0, Math.max(0, opts.maxDocs - judged.length));
    docs = [...judged, ...filler];
  }

  // A judgment pointing at a document not in the corpus would inflate the apparent ceiling.
  const present = new Set(docs.map((d) => d.id));
  let dropped = 0;
  for (const q of queries) {
    for (const id of [...q.relevant.keys()]) {
      if (!present.has(id)) {
        q.relevant.delete(id);
        dropped++;
      }
    }
  }
  if (dropped > 0) console.log(`[beir] dropped ${dropped} judgments referencing absent documents`);

  const graded = queries.some((q) => [...q.relevant.values()].some((g) => g !== 1));

  return {
    name: `beir/${subset}`,
    version: `beir-${subset}-2021`,
    docs,
    queries,
    graded,
    source: spec.url,
  };
}
