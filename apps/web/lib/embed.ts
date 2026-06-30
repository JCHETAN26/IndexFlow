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

/** Embed a batch of texts. Returns one 384-dim unit vector per input. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
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
