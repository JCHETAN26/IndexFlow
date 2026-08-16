/**
 * Structured ground truth, generated before a word of prose exists.
 *
 * The order matters. Generating documents first and labelling them afterwards means the labels are
 * one person's opinion about text — which is exactly the weakness recorded against the in-domain
 * corpus, where every number rests on unaudited judgment. Here the truth is the structure: a
 * scenario states its own root cause, fix, error code and versions, and the documents are
 * realisations of it. Relevance then follows from provenance rather than from reading.
 *
 * That is a real strength and a real limitation, and the limitation belongs in the claim ledger:
 * qrels derived this way are true *by construction*, not by human judgment. They cannot be wrong
 * about which document discusses which incident, and they cannot capture a human finding a document
 * useful for a reason the generator never modelled.
 *
 * ## Core and filler
 *
 * Scenarios come in two kinds. **Core** scenarios are labelled and queried, and the set is fixed —
 * the same core exists at 1K documents and at 100K. **Filler** scenarios are unlabelled distractors
 * that grow to reach whatever corpus size is asked for. Queries and qrels therefore freeze once and
 * stay valid at every scale, which is what makes a scale curve honest: only the haystack grows.
 *
 * ## Hard negatives
 *
 * Every core scenario spawns siblings that are deliberately nearly it — same fault on a different
 * platform, same service with a neighbouring error code, the same number in a different unit, an
 * earlier version of the same guidance now superseded. They are graded 0. Without them a query
 * would only have to find the right *area* of the corpus; with them it has to discriminate inside
 * a cluster of near-identical documents, which is where sparse and dense retrieval actually differ.
 */
import { CONCEPTS, type Concept } from "./lexicon";
import type { Rng } from "./rng";

export const SERVICES = [
  "editor-sync", "editor-render", "auth-gateway", "session-store", "search-api", "search-indexer",
  "billing-core", "billing-webhooks", "upload-intake", "media-transform", "export-worker",
  "collab-relay", "notify-dispatch", "quota-meter", "flag-service", "trace-collector",
] as const;

export const PLATFORMS = ["iOS", "Android", "web", "desktop"] as const;
export const ENVIRONMENTS = ["production", "staging", "canary"] as const;
export const TEAMS = [
  "mobile-platform", "identity", "search", "billing", "media", "collaboration",
  "infrastructure", "observability", "developer-platform",
] as const;
export const SEVERITIES = ["SEV-1", "SEV-2", "SEV-3"] as const;

/**
 * Error-code families, built so neighbours differ by one digit or one noun. An exact-identifier
 * query for ERR_AUTH_401 must not be satisfiable by ERR_AUTH_403 or ERR_TOKEN_401.
 */
export const ERROR_FAMILIES: Record<string, readonly string[]> = {
  authentication: ["ERR_AUTH_401", "ERR_AUTH_403", "ERR_AUTH_419", "ERR_TOKEN_401", "ERR_SESSION_401"],
  database: ["ERR_POOL_503", "ERR_POOL_504", "ERR_CONN_503", "ERR_STMT_504"],
  search: ["ERR_TIMEOUT_504", "ERR_TIMEOUT_503", "ERR_QUERY_504", "ERR_RANK_504"],
  webhooks: ["ERR_HOOK_429", "ERR_HOOK_502", "ERR_DELIVER_429", "ERR_SIGN_401"],
  billing: ["ERR_PAY_402", "ERR_PAY_409", "ERR_CARD_402", "ERR_INVOICE_402"],
  uploads: ["ERR_UPLOAD_413", "ERR_UPLOAD_415", "ERR_MEDIA_413", "ERR_SCAN_415"],
  storage: ["ERR_QUOTA_507", "ERR_QUOTA_413", "ERR_STORE_507"],
  exports: ["ERR_EXPORT_500", "ERR_EXPORT_504", "ERR_STREAM_500"],
  collaboration: ["ERR_MERGE_409", "ERR_MERGE_412", "ERR_SYNC_409"],
  deployment: ["ERR_MIGRATE_423", "ERR_LOCK_423", "ERR_DEPLOY_500"],
  caching: ["ERR_CACHE_409", "ERR_PURGE_502"],
  queues: ["ERR_QUEUE_429", "ERR_WORKER_503"],
  notifications: ["ERR_NOTIFY_429", "ERR_NOTIFY_502"],
  security: ["ERR_SECRET_401", "ERR_ROTATE_401"],
  release: ["ERR_FLAG_409", "ERR_FLAG_412"],
  observability: ["ERR_TRACE_500", "ERR_SAMPLE_500"],
  api: ["ERR_RATE_429", "ERR_BUDGET_429"],
  editor: ["ERR_SYNC_429", "ERR_SYNC_409", "ERR_SAVE_429"],
};

/**
 * Paired quantities that differ by unit or magnitude rather than by kind. A numeric query has to
 * resolve which one is current, so "what is the storage limit" cannot be answered by finding any
 * document that mentions a limit.
 */
export const NUMERIC_TRAPS = [
  { unit: "GB of storage", values: [30, 300] },
  { unit: "requests per second", values: [30, 300] },
  { unit: "requests per minute", values: [300, 3000] },
  { unit: "second retry delay", values: [15, 900] },
  { unit: "minute retention window", values: [15, 900] },
  { unit: "concurrent connections", values: [30, 80] },
  { unit: "millisecond debounce interval", values: [750, 75] },
] as const;

export interface Scenario {
  id: string;
  kind: "core" | "hard-negative" | "filler";
  /** For hard negatives and superseded revisions: the core scenario they are near. */
  nearId?: string;
  /** How this scenario differs from the core it shadows. Drives the query that must separate them. */
  discriminator?: "platform" | "service" | "error-code" | "numeric" | "superseded";
  conceptId: string;
  domain: string;
  service: string;
  platform: string;
  environment: string;
  team: string;
  severity: string;
  errorCode: string;
  affectedVersion: string;
  resolvedVersion: string;
  baselineMs: number;
  degradedMs: number;
  quantity: { value: number; unit: string };
  /** Engineering-voice root cause, drawn from the concept's document side. */
  rootCause: string;
  /** Engineering-voice mitigation. */
  mitigation: string;
  /** User-voice symptom, drawn from the concept's query side. Never written into a document. */
  symptom: string;
  /** User-voice goal. Never written into a document. */
  goal: string;
  /** True when a later scenario supersedes this one; the benchmark knows which guidance is current. */
  superseded: boolean;
  supersededBy?: string;
}

const version = (rng: Rng) => `${rng.int(3, 9)}.${rng.int(0, 40)}.${rng.int(0, 9)}`;

function bumpPatch(v: string): string {
  const [maj, min, patch] = v.split(".").map(Number);
  return `${maj}.${min}.${patch + 1}`;
}

/**
 * Filler carries its own id prefix. Core and its near-misses share one sequence within a single
 * `generateScenarios` call, but filler is generated in a separate call whose sequence restarts at
 * zero — so without a distinct prefix a background scenario silently takes an incident's id, two
 * documents end up with the same key, and the failure surfaces hundreds of lines later as a
 * Postgres unique-violation during seeding. Which is exactly how it was found.
 */
function baseScenario(rng: Rng, concept: Concept, seq: number, kind: Scenario["kind"]): Scenario {
  const prefix = kind === "filler" ? "BKG" : "INC";
  const family = ERROR_FAMILIES[concept.domain] ?? ERROR_FAMILIES.api;
  const affected = version(rng);
  const trap = rng.pick(NUMERIC_TRAPS);
  const baseline = rng.int(60, 260);
  return {
    id: `${prefix}-${10000 + seq}`,
    kind,
    conceptId: concept.id,
    domain: concept.domain,
    service: rng.pick(SERVICES),
    platform: rng.pick(PLATFORMS),
    environment: rng.pick(ENVIRONMENTS),
    team: rng.pick(TEAMS),
    severity: rng.pick(SEVERITIES),
    errorCode: rng.pick(family),
    affectedVersion: affected,
    resolvedVersion: bumpPatch(affected),
    baselineMs: baseline,
    degradedMs: baseline * rng.int(4, 12),
    quantity: { value: rng.pick(trap.values), unit: trap.unit },
    rootCause: rng.pick(concept.docPhrases),
    mitigation: rng.pick(concept.docFixes),
    symptom: rng.pick(concept.userPhrases),
    goal: rng.pick(concept.userGoals),
    superseded: false,
  };
}

/**
 * Build siblings that are near-misses for `core`, each differing along exactly one axis.
 *
 * One axis at a time is the point. A sibling that differs in three ways is easy to reject on any of
 * them; a sibling that differs only in platform forces the retriever to carry "iOS" through the
 * whole ranking rather than matching the surrounding story.
 */
function hardNegativesFor(rng: Rng, core: Scenario, concept: Concept, startSeq: number): Scenario[] {
  const family = ERROR_FAMILIES[core.domain] ?? ERROR_FAMILIES.api;
  const out: Scenario[] = [];
  let seq = startSeq;

  // Every sibling must differ from the core along an axis the anchored queries actually mention —
  // the service or the platform. An earlier revision varied only the error code or only a quantity
  // while holding service and platform fixed, which does not produce a hard negative: a query
  // reading "<symptom> on <service> for <platform>" cannot separate those from the target at all,
  // so the retriever was being scored on a coin flip and every strategy looked broken. Measured, it
  // put two unresolvable competitors next to each target and held nDCG@10 near 0.11 across the
  // board. The code and quantity variations are kept — they are what identifier and numeric queries
  // have to discriminate — but they now ride on top of an observable difference.
  const otherPlatforms = rng.shuffle(PLATFORMS.filter((p) => p !== core.platform));

  out.push({
    ...baseScenario(rng, concept, seq++, "hard-negative"),
    nearId: core.id,
    discriminator: "platform",
    service: core.service,
    domain: core.domain,
    platform: otherPlatforms[0],
    errorCode: core.errorCode,
  });

  const otherService = rng.pick(SERVICES.filter((s) => s !== core.service));
  out.push({
    ...baseScenario(rng, concept, seq++, "hard-negative"),
    nearId: core.id,
    discriminator: "service",
    service: otherService,
    domain: core.domain,
    platform: core.platform,
  });

  const otherCode = family.filter((c) => c !== core.errorCode);
  if (otherCode.length > 0 && otherPlatforms.length > 1) {
    out.push({
      ...baseScenario(rng, concept, seq++, "hard-negative"),
      nearId: core.id,
      discriminator: "error-code",
      service: core.service,
      domain: core.domain,
      platform: otherPlatforms[1],
      errorCode: rng.pick(otherCode),
    });
  }

  const trap = NUMERIC_TRAPS.find((t) => t.unit === core.quantity.unit)!;
  const otherValue = trap.values.find((v) => v !== core.quantity.value);
  if (otherValue !== undefined && otherPlatforms.length > 2) {
    out.push({
      ...baseScenario(rng, concept, seq++, "hard-negative"),
      nearId: core.id,
      discriminator: "numeric",
      service: core.service,
      domain: core.domain,
      platform: otherPlatforms[2],
      quantity: { value: otherValue, unit: core.quantity.unit },
    });
  }

  return out;
}

/**
 * A superseded predecessor: the same incident with the earlier, now-wrong guidance.
 *
 * This is what makes a "which is current" query answerable and non-trivial. Both documents describe
 * the same service and the same fault; only one is still true, and nothing in the surface text
 * shouts which — the reader has to use the version or the supersession note.
 */
function supersededFor(rng: Rng, core: Scenario, concept: Concept, seq: number): Scenario {
  const older = `${core.affectedVersion.split(".")[0]}.${Math.max(
    0,
    Number(core.affectedVersion.split(".")[1]) - rng.int(1, 4),
  )}.0`;
  const trap = NUMERIC_TRAPS.find((t) => t.unit === core.quantity.unit)!;
  const otherValue = trap.values.find((v) => v !== core.quantity.value) ?? core.quantity.value;
  return {
    ...baseScenario(rng, concept, seq, "hard-negative"),
    nearId: core.id,
    discriminator: "superseded",
    service: core.service,
    domain: core.domain,
    platform: core.platform,
    errorCode: core.errorCode,
    affectedVersion: older,
    resolvedVersion: bumpPatch(older),
    quantity: { value: otherValue, unit: core.quantity.unit },
    superseded: true,
    supersededBy: core.id,
  };
}

export interface ScenarioSet {
  core: Scenario[];
  hardNegatives: Scenario[];
  filler: Scenario[];
}

/**
 * `coreCount` labelled scenarios, their near-miss siblings, and as much unlabelled filler as the
 * caller wants. Deterministic given the rng.
 */
export function generateScenarios(rng: Rng, coreCount: number, fillerCount: number): ScenarioSet {
  const core: Scenario[] = [];
  const hardNegatives: Scenario[] = [];
  const filler: Scenario[] = [];
  let seq = 0;

  const coreRng = rng.fork("core");
  for (let i = 0; i < coreCount; i++) {
    const concept = CONCEPTS[i % CONCEPTS.length];
    const s = baseScenario(coreRng, concept, seq++, "core");
    core.push(s);
    for (const hn of hardNegativesFor(coreRng, s, concept, seq)) {
      hardNegatives.push(hn);
      seq++;
    }
    // Not every incident has a superseded predecessor; a corpus where every fact has exactly one
    // stale twin is its own kind of unrealistic regularity.
    if (coreRng.chance(0.45)) {
      hardNegatives.push(supersededFor(coreRng, s, concept, seq++));
    }
  }

  const fillerRng = rng.fork("filler");
  for (let i = 0; i < fillerCount; i++) {
    filler.push(baseScenario(fillerRng, CONCEPTS[i % CONCEPTS.length], seq++, "filler"));
  }

  return { core, hardNegatives, filler };
}
