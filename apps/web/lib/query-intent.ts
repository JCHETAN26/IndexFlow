/**
 * Query intent detection — deployable signals only.
 *
 * The evidence for routing is narrow and specific: on the corrected SaaSBench benchmark the keyword
 * leg reaches **MRR@10 1.000** on identifier queries where hybrid fusion manages 0.648. Blending a
 * dense score into an exact-token lookup actively destroys a perfect result, because the dense leg
 * has nothing useful to say about `INC-10042` and its contribution is noise.
 *
 * Every earlier argument for a sparse/dense router came from benchmark-invalid runs and was
 * discarded. This one does not: it survives on the frozen 2.0.0 benchmark, and the signal it needs
 * is available at inference time from the query string alone.
 *
 * ## What this deliberately does NOT do
 *
 * It does not consult SaaSBench query classes. A benchmark label is not a deployable signal, and
 * routing on one would produce a system that works only on the benchmark — the exact circularity
 * this project has spent its evaluation work eliminating. Detection is regex over the query text,
 * so it behaves identically on a real user's query.
 *
 * It also does not classify anything as a lookup merely for *containing* an identifier. "Why does
 * auth-api return ERR_AUTH_401 after the last deploy?" is a natural-language question that happens
 * to cite a code; sending it down an exact-match path would discard the question. A query is a
 * lookup only when the identifier is essentially the whole of it.
 */

export type IdentifierKind = "error-code" | "ticket" | "version";

export interface DetectedIdentifier {
  kind: IdentifierKind;
  /** Exactly as the user typed it. */
  raw: string;
  /** Canonical form, for exact-field matching: ERR-AUTH-401 and "err auth 401" both become ERR_AUTH_401. */
  normalized: string;
}

export interface QueryIntent {
  identifiers: DetectedIdentifier[];
  /** True when the query is essentially an identifier lookup and nothing else. */
  isIdentifierLookup: boolean;
  /** Content words left once identifiers are removed — what a semantic leg would have to work with. */
  residualTerms: string[];
}

/**
 * Screaming-snake or kebab error codes: ERR_AUTH_401, ERR-SYNC-429, HTTP_503.
 * Requires a leading alphabetic segment so bare version numbers do not match here.
 */
const ERROR_CODE = /\b([A-Z][A-Z0-9]{1,})(?:[_-][A-Z0-9]+)+\b/gi;

/** Prefixed record identifiers: INC-48291, TICKET_2819, DEPLOY-1738, PAY 55210. */
const TICKET = /\b(INC|TS|TICKET|DEP|DEPLOY|PAY|BUG|SEC|CASE|REQ)[\s_-]?(\d{3,})\b/gi;

/** Semantic versions, with or without a v prefix: v4.18.3, 4.18.3, 4.18. */
const VERSION = /\bv?(\d+\.\d+(?:\.\d+)?)\b/gi;

/**
 * Spaced error codes: "err auth 401". Users type these, and without normalisation an exact-field
 * match never fires. Deliberately conservative — it needs a known prefix word so ordinary prose
 * containing a number is not swept up.
 */
const SPACED_CODE = /\b(err|error|errno)\s+([a-z]+)\s+(\d{3,})\b/gi;

const STOP = new Set(
  ("a an and are as at be by do does for from has have how i in into is it its of on or our so than that the " +
    "their them then there these they this to up was we were what when where which who why will with you your " +
    "about after before over under out off again more most some any all did not no if should would could can " +
    "may might must show find search look get give tell me my us please").split(/\s+/),
);

function normalizeErrorCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "_");
}

/** Extract every deployable identifier signal from a query. */
export function detectIdentifiers(query: string): DetectedIdentifier[] {
  const found: DetectedIdentifier[] = [];
  const claimed: [number, number][] = [];
  const overlaps = (start: number, end: number) =>
    claimed.some(([s, e]) => start < e && end > s);
  const take = (m: RegExpMatchArray, kind: IdentifierKind, normalized: string) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlaps(start, end)) return;
    claimed.push([start, end]);
    found.push({ kind, raw: m[0], normalized });
  };

  // Order matters: the most specific patterns claim their span first, so a ticket id is never also
  // reported as a version and a spaced code is never split into fragments.
  for (const m of query.matchAll(SPACED_CODE)) {
    take(m, "error-code", normalizeErrorCode(`${m[1]}_${m[2]}_${m[3]}`));
  }
  for (const m of query.matchAll(TICKET)) {
    take(m, "ticket", `${m[1].toUpperCase()}-${m[2]}`);
  }
  for (const m of query.matchAll(ERROR_CODE)) {
    take(m, "error-code", normalizeErrorCode(m[0]));
  }
  for (const m of query.matchAll(VERSION)) {
    take(m, "version", m[1]);
  }
  return found.sort((a, b) => query.indexOf(a.raw) - query.indexOf(b.raw));
}

/**
 * How many identifier-free content words a query may carry and still count as a lookup.
 *
 * Two, not zero: "ERR_AUTH_401 runbook" and "INC-10042 postmortem" are still lookups, while a
 * sentence asking a question that cites a code is not. Set low deliberately — misrouting a question
 * to an exact-match path loses the question, which is far worse than sending a lookup through the
 * ordinary pipeline where it merely scores less well.
 */
const MAX_RESIDUAL_TERMS = 2;

export function analyzeQuery(query: string): QueryIntent {
  const identifiers = detectIdentifiers(query);
  let residual = query;
  for (const id of identifiers) residual = residual.replace(id.raw, " ");
  const residualTerms = residual
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

  return {
    identifiers,
    residualTerms,
    isIdentifierLookup: identifiers.length > 0 && residualTerms.length <= MAX_RESIDUAL_TERMS,
  };
}
