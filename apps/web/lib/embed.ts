import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Local sentence embeddings via all-MiniLM-L6-v2 (384-dim), run through ONNX in-process.
 * No API key, no network at query time after the first model download. Vectors are
 * mean-pooled and L2-normalized, so cosine similarity == dot product.
 */
export const EMBED_DIM = 384;
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

// Cache the pipeline across requests (and across hot reloads in dev).
const globalForEmbed = globalThis as unknown as {
  __embedExtractor?: Promise<FeatureExtractionPipeline>;
};

function getExtractor(): Promise<FeatureExtractionPipeline> {
  globalForEmbed.__embedExtractor ??= pipeline("feature-extraction", EMBED_MODEL);
  return globalForEmbed.__embedExtractor;
}

/**
 * How many texts go through the model at once.
 *
 * transformers.js pads a batch to its longest sequence and allocates one tensor for the whole
 * batch, so cost is `batch × longest_sequence × 384` floats — quadratic in practice, because a
 * bigger batch is also likelier to contain a long text. Passing 11,562 chunks in a single call
 * asks for roughly 4.5 GB and is killed by the OS; that is not hypothetical, it happened on a CI
 * runner during the Phase 8 scale-up. 64 keeps peak allocation in the tens of megabytes with no
 * measurable throughput loss.
 */
const EMBED_BATCH = Number(process.env.EMBED_BATCH ?? 64);

/**
 * Embed texts. Returns one 384-dim unit vector per input, in input order.
 *
 * Batched internally, so callers can pass an arbitrarily long list without having to know the
 * memory characteristics of the model.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const output = await extractor(texts.slice(i, i + EMBED_BATCH), {
      pooling: "mean",
      normalize: true,
    });
    out.push(...(output.tolist() as number[][]));
  }
  return out;
}

/** Embed a single text. */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}

/** Format a number[] as a pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
