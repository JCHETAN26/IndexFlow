export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

const TARGET_WORDS = 180;
const OVERLAP_WORDS = 30;

/** Rough token estimate (~0.75 words/token English). Good enough for display + budgeting. */
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 0.75));
}

/**
 * Split text into overlapping chunks on paragraph boundaries, packing paragraphs
 * up to ~TARGET_WORDS. Long paragraphs are word-windowed. Overlap preserves context
 * across chunk boundaries so a match near an edge still has surrounding text.
 */
export function chunkText(raw: string): Chunk[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Fall back to the whole text as one block if there are no paragraph breaks.
  const blocks = paragraphs.length > 0 ? paragraphs : [text];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join("\n\n"));
    current = [];
    currentWords = 0;
  };

  for (const block of blocks) {
    const blockWords = block.split(/\s+/).filter(Boolean);

    // Oversized paragraph: window it on its own.
    if (blockWords.length > TARGET_WORDS) {
      flush();
      let start = 0;
      while (start < blockWords.length) {
        const end = Math.min(start + TARGET_WORDS, blockWords.length);
        chunks.push(blockWords.slice(start, end).join(" "));
        if (end >= blockWords.length) break;
        start = end - OVERLAP_WORDS;
      }
      continue;
    }

    if (currentWords + blockWords.length > TARGET_WORDS) flush();
    current.push(block);
    currentWords += blockWords.length;
  }
  flush();

  return chunks.map((content, index) => ({
    index,
    content,
    tokenCount: estimateTokens(content),
  }));
}
