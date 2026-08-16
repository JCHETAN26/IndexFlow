/**
 * The 100k-document scale corpus, built deterministically so it can be embedded in parallel.
 *
 * Phase 9a asks how retrieval quality degrades as the candidate pool grows, holding the query set
 * fixed. That requires one corpus that *nests*: the 500-document tier must be a subset of the
 * 5k tier, and so on, or a change between tiers confounds corpus size with corpus composition.
 *
 * Construction:
 *   1. The **judged core** — every document relevant to one of SciFact's 300 test queries. Only
 *      ~333 documents, which is what makes a 500-document tier possible at all.
 *   2. **Distractors**, appended in a fixed order: first the remaining SciFact documents, then
 *      TREC-COVID. TREC-COVID is scientific abstracts, the same genre as SciFact, so these are
 *      hard negatives rather than trivially separable filler — padding with, say, product reviews
 *      would make the task easier as the corpus grew, which is the opposite of the intent.
 *
 * Every tier is a prefix of the document list, so tiers nest by construction and the largest tier
 * can be embedded once and subset for the rest.
 *
 * Determinism matters more than usual here: the embedding is sharded across parallel CI jobs that
 * never see each other, and each shard must agree exactly on the global chunk ordering. Every
 * ordering below is either an explicit sort or a fixed concatenation, and `datasetSha` lets a
 * consumer prove the shards were built from the same list.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkText } from "../lib/chunk";
import { BEIR_SUBSETS, fetchSubset } from "./beir";
import type { EvalQuery } from "./dataset";

export const SCALE_TIERS = [500, 5_000, 25_000, 100_000] as const;
export const TOP_TIER = SCALE_TIERS[SCALE_TIERS.length - 1];

export interface ScaleDoc {
  id: string;
  title: string;
  content: string;
  /** Which corpus it came from, so provenance survives into the report. */
  source: "scifact" | "trec-covid";
}

export interface ScaleChunk {
  /** Position in the global ordering. Determines which shard embeds it. */
  globalIndex: number;
  docId: string;
  chunkIndex: number;
  content: string;
}

const readJsonl = async <T>(path: string): Promise<T[]> =>
  (await readFile(path, "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);

async function readQrels(path: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  for (const line of (await readFile(path, "utf8")).split("\n").slice(1)) {
    if (!line.trim()) continue;
    const [qid, docId, score] = line.split("\t");
    const gain = Number(score);
    if (!Number.isFinite(gain) || gain <= 0) continue;
    if (!out.has(qid)) out.set(qid, new Map());
    out.get(qid)!.set(docId, gain);
  }
  return out;
}

export interface ScaleDataset {
  docs: ScaleDoc[];
  queries: EvalQuery[];
  /** Fingerprint of the ordered document ids — shards must agree on this. */
  datasetSha: string;
  numJudgedDocs: number;
}

/**
 * Build the document list up to `maxDocs`. Judged documents always come first, so no tier can
 * drop one — losing a judged document would silently raise the apparent score by removing a
 * question the system could get wrong.
 */
export async function buildScaleDataset(maxDocs: number = TOP_TIER): Promise<ScaleDataset> {
  const sciDir = await fetchSubset(BEIR_SUBSETS.scifact);
  const covidDir = await fetchSubset(BEIR_SUBSETS["trec-covid"]);

  const sciDocs = await readJsonl<{ _id: string; title: string; text: string }>(
    join(sciDir, "corpus.jsonl"),
  );
  const sciQueries = await readJsonl<{ _id: string; text: string }>(join(sciDir, "queries.jsonl"));
  const testQrels = await readQrels(join(sciDir, "qrels", "test.tsv"));
  const trainQrels = await readQrels(join(sciDir, "qrels", "train.tsv"));

  const queryText = new Map(sciQueries.map((q) => [q._id, q.text]));
  const queries: EvalQuery[] = [];
  for (const [qid, rel] of [...trainQrels].sort((a, b) => a[0].localeCompare(b[0]))) {
    const text = queryText.get(qid);
    if (text) queries.push({ id: qid, text, relevant: rel, split: "tune" });
  }
  for (const [qid, rel] of [...testQrels].sort((a, b) => a[0].localeCompare(b[0]))) {
    const text = queryText.get(qid);
    if (text) queries.push({ id: qid, text, relevant: rel, split: "test" });
  }

  // Judged = relevant to ANY query we will score, tuning or held-out.
  const judged = new Set<string>();
  for (const q of queries) for (const id of q.relevant.keys()) judged.add(id);

  const byId = new Map(sciDocs.map((d) => [d._id, d]));
  const toDoc = (id: string, source: ScaleDoc["source"], title: string, text: string): ScaleDoc => ({
    id: `${source === "scifact" ? "sf" : "tc"}:${id}`,
    title: title ?? "",
    content: text ?? "",
    source,
  });

  const judgedIds = [...judged].filter((id) => byId.has(id)).sort();
  const docs: ScaleDoc[] = judgedIds.map((id) =>
    toDoc(id, "scifact", byId.get(id)!.title, byId.get(id)!.text),
  );
  const numJudgedDocs = docs.length;

  // Remaining SciFact, then TREC-COVID, both in sorted id order.
  if (docs.length < maxDocs) {
    for (const d of sciDocs.filter((d) => !judged.has(d._id)).sort((a, b) => a._id.localeCompare(b._id))) {
      if (docs.length >= maxDocs) break;
      docs.push(toDoc(d._id, "scifact", d.title, d.text));
    }
  }
  if (docs.length < maxDocs) {
    const covid = await readJsonl<{ _id: string; title: string; text: string }>(
      join(covidDir, "corpus.jsonl"),
    );
    for (const d of covid.sort((a, b) => a._id.localeCompare(b._id))) {
      if (docs.length >= maxDocs) break;
      docs.push(toDoc(d._id, "trec-covid", d.title, d.text));
    }
  }

  // Remap judgments onto the prefixed ids, and drop any pointing outside the corpus.
  const present = new Set(docs.map((d) => d.id));
  for (const q of queries) {
    const remapped = new Map<string, number>();
    for (const [id, gain] of q.relevant) {
      const prefixed = `sf:${id}`;
      if (present.has(prefixed)) remapped.set(prefixed, gain);
    }
    q.relevant = remapped;
  }

  const datasetSha = createHash("sha256")
    .update(docs.map((d) => d.id).join("\n"))
    .digest("hex")
    .slice(0, 16);

  return { docs, queries, datasetSha, numJudgedDocs };
}

/**
 * Enumerate chunks in the global order every shard must agree on.
 *
 * `keep` lets a shard discard chunks it will not embed *as it goes*, so a worker holds only its
 * own slice rather than all 152k chunk bodies.
 */
export function enumerateChunks(
  docs: ScaleDoc[],
  keep: (globalIndex: number) => boolean = () => true,
): { chunks: ScaleChunk[]; total: number } {
  const chunks: ScaleChunk[] = [];
  let globalIndex = 0;
  for (const d of docs) {
    const body = d.title ? `${d.title}\n\n${d.content}` : d.content;
    for (const c of chunkText(body)) {
      if (keep(globalIndex)) {
        chunks.push({ globalIndex, docId: d.id, chunkIndex: c.index, content: c.content });
      }
      globalIndex++;
    }
  }
  return { chunks, total: globalIndex };
}

/** Chunk counts per tier, without materialising chunk bodies. */
export function chunkCountsByTier(docs: ScaleDoc[]): Map<number, number> {
  const out = new Map<number, number>();
  let count = 0;
  let tierIdx = 0;
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const body = d.title ? `${d.title}\n\n${d.content}` : d.content;
    count += chunkText(body).length;
    while (tierIdx < SCALE_TIERS.length && i + 1 === Math.min(SCALE_TIERS[tierIdx], docs.length)) {
      out.set(SCALE_TIERS[tierIdx], count);
      tierIdx++;
    }
  }
  while (tierIdx < SCALE_TIERS.length) {
    out.set(SCALE_TIERS[tierIdx], count);
    tierIdx++;
  }
  return out;
}
