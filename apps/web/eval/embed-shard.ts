/**
 * Embed one shard of the 100k-document scale corpus.
 *
 * Embedding 152k chunks takes about 2.7 hours on a single CI runner — inside the 6-hour job
 * ceiling, but with no margin, and any hiccup wastes the whole run. Sharding across a job matrix
 * turns that into ~14 minutes of wall clock and makes a failure cost one shard instead of
 * everything.
 *
 * The shards never see each other, so correctness rests entirely on `scale-dataset.ts` producing
 * the same global chunk ordering in every job. Each shard writes `datasetSha` into its manifest
 * and the consumer refuses to proceed unless they all agree — a silent disagreement would scatter
 * vectors onto the wrong chunks and produce a plausible-looking but meaningless result.
 *
 * Output is raw little-endian float32, not JSON: 152k × 384 floats is 234 MB as binary and roughly
 * 3 GB as text.
 *
 * Run: SHARD_INDEX=0 SHARD_COUNT=12 pnpm --filter @indexflow/web eval:embed-shard
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { embed, EMBED_DIM } from "../lib/embed";
import { buildScaleDataset, enumerateChunks, TOP_TIER } from "./scale-dataset";

const SHARD_INDEX = Number(process.env.SHARD_INDEX ?? 0);
const SHARD_COUNT = Number(process.env.SHARD_COUNT ?? 1);
const OUT_DIR = process.env.SHARD_OUT ?? join(process.cwd(), ".evalrun", "shards");
const MAX_DOCS = Number(process.env.SCALE_MAX_DOCS ?? TOP_TIER);

async function main() {
  if (!Number.isInteger(SHARD_INDEX) || SHARD_INDEX < 0 || SHARD_INDEX >= SHARD_COUNT) {
    throw new Error(`SHARD_INDEX=${SHARD_INDEX} out of range for SHARD_COUNT=${SHARD_COUNT}`);
  }
  const t0 = Date.now();
  const el = () => `${Math.round((Date.now() - t0) / 1000)}s`;

  console.log(`[shard ${SHARD_INDEX}/${SHARD_COUNT}] building dataset (max ${MAX_DOCS} docs)...`);
  const { docs, datasetSha, numJudgedDocs } = await buildScaleDataset(MAX_DOCS);
  console.log(`[${el()}] ${docs.length} docs (${numJudgedDocs} judged) · datasetSha ${datasetSha}`);

  // Keep only this shard's chunks. The predicate runs during enumeration, so a worker never holds
  // all 152k chunk bodies — only its own ~12k.
  const { chunks, total } = enumerateChunks(docs, (i) => i % SHARD_COUNT === SHARD_INDEX);
  console.log(`[${el()}] ${total} chunks total, ${chunks.length} in this shard`);

  const out = new Float32Array(chunks.length * EMBED_DIM);
  const SLICE = 512;
  for (let i = 0; i < chunks.length; i += SLICE) {
    const batch = chunks.slice(i, i + SLICE);
    const vecs = await embed(batch.map((c) => c.content));
    for (let j = 0; j < vecs.length; j++) out.set(vecs[j], (i + j) * EMBED_DIM);
    const done = Math.min(i + SLICE, chunks.length);
    const rate = done / Math.max(1, (Date.now() - t0) / 1000);
    console.log(
      `[${el()}] ${done}/${chunks.length}  ${rate.toFixed(1)} chunks/s  ` +
        `rss=${Math.round(process.memoryUsage().rss / 1e6)}MB`,
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `shard-${SHARD_INDEX}.f32`), Buffer.from(out.buffer, 0, out.byteLength));
  writeFileSync(
    join(OUT_DIR, `shard-${SHARD_INDEX}.json`),
    JSON.stringify(
      {
        shardIndex: SHARD_INDEX,
        shardCount: SHARD_COUNT,
        datasetSha,
        maxDocs: MAX_DOCS,
        numDocs: docs.length,
        numChunksTotal: total,
        numChunksShard: chunks.length,
        dim: EMBED_DIM,
        // First and last global indices, so a consumer can sanity-check the stride assumption.
        firstGlobalIndex: chunks[0]?.globalIndex ?? null,
        lastGlobalIndex: chunks[chunks.length - 1]?.globalIndex ?? null,
        elapsedSeconds: Math.round((Date.now() - t0) / 1000),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`[${el()}] wrote shard ${SHARD_INDEX}: ${chunks.length} vectors, ${(out.byteLength / 1e6).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
