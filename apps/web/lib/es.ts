import { Client } from "@elastic/elasticsearch";

/**
 * Elasticsearch keyword index (plan §7). Chunks are dual-written here on ingest
 * (Postgres holds the source of truth + embeddings; ES owns keyword search,
 * BM25 ranking, and highlighting). The eval harness spins up ephemeral indices
 * so it can measure the real BM25 keyword strategy without touching prod data.
 */
export const ES_URL = process.env.ES_URL ?? "http://localhost:9200";
export const CHUNK_INDEX = process.env.ES_INDEX ?? "indexflow_chunks";

// Highlight sentinels — the search route HTML-escapes the snippet, then swaps these
// for <mark> so raw chunk content can't inject markup (XSS-safe highlighting).
export const HL_START = "@@HL_START@@";
export const HL_END = "@@HL_END@@";

let client: Client | undefined;
export function es(): Client {
  // Lazy singleton so importing this module (e.g. during `next build`) never connects.
  client ??= new Client({ node: ES_URL });
  return client;
}

const MAPPING = {
  properties: {
    chunk_id: { type: "keyword" },
    document_id: { type: "keyword" },
    chunk_index: { type: "integer" },
    title: { type: "text" },
    file_type: { type: "keyword" },
    content: { type: "text" },
    metadata: { type: "object", enabled: false },
    created_at: { type: "date" },
  },
} as const;

export async function ensureChunkIndex(index: string = CHUNK_INDEX): Promise<void> {
  const exists = await es().indices.exists({ index });
  if (!exists) {
    // ignore 400 "resource_already_exists" from a concurrent creator.
    await es()
      .indices.create({ index, mappings: MAPPING })
      .catch((e) => {
        if (e?.meta?.body?.error?.type !== "resource_already_exists_exception") throw e;
      });
  }
}

export async function deleteIndex(index: string): Promise<void> {
  await es().indices.delete({ index }, { ignore: [404] });
}

/** Fresh, uniquely-named index for a single eval run (torn down afterward). */
export async function createEphemeralIndex(prefix = "indexflow_eval"): Promise<string> {
  const index = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await es().indices.create({ index, mappings: MAPPING });
  return index;
}

export interface EsChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  fileType: string;
  content: string;
  createdAt?: Date;
}

type Refresh = boolean | "wait_for";

export async function indexChunks(
  chunks: EsChunk[],
  index: string = CHUNK_INDEX,
  refresh: Refresh = false,
): Promise<void> {
  if (chunks.length === 0) return;
  const operations = chunks.flatMap((c) => [
    { index: { _index: index, _id: c.chunkId } },
    {
      chunk_id: c.chunkId,
      document_id: c.documentId,
      chunk_index: c.chunkIndex,
      title: c.title,
      file_type: c.fileType,
      content: c.content,
      created_at: c.createdAt ?? new Date(),
    },
  ]);
  const res = await es().bulk({ operations, refresh });
  if (res.errors) {
    const firstErr = res.items.find((i) => i.index?.error)?.index?.error;
    throw new Error(`ES bulk index failed: ${JSON.stringify(firstErr)}`);
  }
}

/** Remove all chunks for a document. No-op if the index doesn't exist yet. */
export async function deleteDocumentChunks(
  documentId: string,
  index: string = CHUNK_INDEX,
  refresh: Refresh = false,
): Promise<void> {
  await es()
    .deleteByQuery(
      { index, query: { term: { document_id: documentId } }, conflicts: "proceed", refresh: refresh === true },
      { ignore: [404] },
    )
    .catch((e) => {
      if (e?.meta?.statusCode === 404) return;
      throw e;
    });
}

export interface EsKeywordHit {
  chunkId: string;
  documentId: string;
  title: string;
  fileType: string;
  snippet: string; // sentinel-highlighted; caller escapes + swaps to <mark>
  score: number; // BM25 (unbounded → normalize for display)
}

interface ChunkSource {
  chunk_id: string;
  document_id: string;
  title: string;
  file_type: string;
  content: string;
}

/**
 * BM25 keyword search over chunk content (title lightly boosted), with highlighted
 * fragments. Returns [] if the index doesn't exist yet (nothing indexed).
 */
export async function keywordSearch(
  q: string,
  fileType: string | null,
  size: number,
  index: string = CHUNK_INDEX,
): Promise<EsKeywordHit[]> {
  const res = await es()
    .search<ChunkSource>(
      {
        index,
        size,
        query: {
          bool: {
            must: [{ multi_match: { query: q, fields: ["content", "title^2"], operator: "or" } }],
            ...(fileType ? { filter: [{ term: { file_type: fileType } }] } : {}),
          },
        },
        highlight: {
          pre_tags: [HL_START],
          post_tags: [HL_END],
          fields: { content: { fragment_size: 160, number_of_fragments: 2 } },
        },
      },
      { ignore: [404] },
    )
    .catch((e) => {
      if (e?.meta?.statusCode === 404) return null;
      throw e;
    });

  if (!res || !res.hits?.hits) return [];

  return res.hits.hits.map((h) => {
    const src = h._source!;
    const fragments = h.highlight?.content;
    const snippet =
      fragments && fragments.length > 0 ? fragments.join(" … ") : src.content.slice(0, 320);
    return {
      chunkId: src.chunk_id,
      documentId: src.document_id,
      title: src.title,
      fileType: src.file_type,
      snippet,
      score: h._score ?? 0,
    };
  });
}
