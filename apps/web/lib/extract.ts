import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

// C0 control characters except tab (\x09), newline (\x0A), carriage return (\x0D).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * Strip characters Postgres TEXT / Elasticsearch can't store: null bytes and other C0
 * control chars. PDF extraction in particular can emit stray 0x00 bytes, which Postgres
 * rejects with "invalid byte sequence for encoding UTF8".
 */
function sanitize(text: string): string {
  return text.replace(CONTROL_CHARS, "").trim();
}

/**
 * Extract plain text from a raw uploaded file. `.md`/`.txt` are decoded as UTF-8;
 * `.pdf` is parsed with unpdf (a serverless-friendly build of pdf.js). The extracted
 * text then flows through the same chunk → embed → index pipeline as text files.
 */
export async function extractText(body: Buffer, fileType: string): Promise<string> {
  if (fileType === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return sanitize(text);
  }
  // .md / .txt (and any other text-like upload)
  return sanitize(body.toString("utf8"));
}
