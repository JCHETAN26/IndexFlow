/**
 * Permission model for the benchmark corpus.
 *
 * Existing tests answer "did anything unauthorised leak?", which is a safety question with a binary
 * answer. This model exists to ask a different one: **how much retrieval quality survives once
 * authorisation has shrunk the candidate space?** That needs documents whose visibility varies, and
 * queries whose best global answer is sometimes invisible to the principal asking.
 *
 * Visibility is assigned from the document's *content*, not at random. Security postmortems land in
 * the security group, billing material in finance, and so on, because a corpus where visibility is
 * uncorrelated with subject matter would make permission filtering equivalent to random sampling —
 * which is the one case where it could not possibly change ranking quality.
 */
import type { Rng } from "./rng";
import type { SaasDoc } from "./documents";

export const GROUPS = [
  "engineering", "support", "security", "finance", "mobile", "search", "platform", "billing", "sre",
] as const;
export type Group = (typeof GROUPS)[number];

export interface Principal {
  id: string;
  groups: Group[];
}

/**
 * Principals with deliberately uneven reach. `staff-engineer` sees nearly everything and
 * `contractor` sees very little, so a permission-sensitive query can be posed to someone for whom
 * the best answer is genuinely out of reach — and to someone for whom it is not, as a control.
 */
export const PRINCIPALS: readonly Principal[] = [
  { id: "staff-engineer", groups: ["engineering", "platform", "sre", "search", "mobile"] },
  { id: "support-agent", groups: ["support"] },
  { id: "security-engineer", groups: ["security", "engineering"] },
  { id: "finance-analyst", groups: ["finance", "billing"] },
  { id: "mobile-developer", groups: ["mobile", "engineering"] },
  { id: "contractor", groups: [] },
];

/** Which group owns material about a given domain. */
const DOMAIN_GROUP: Record<string, Group> = {
  authentication: "security",
  security: "security",
  billing: "finance",
  editor: "mobile",
  search: "search",
  database: "platform",
  deployment: "sre",
  caching: "platform",
  queues: "platform",
  storage: "platform",
  uploads: "media" as Group, // falls through to engineering below
  collaboration: "engineering",
  notifications: "engineering",
  release: "engineering",
  observability: "sre",
  api: "platform",
  exports: "engineering",
};

export interface AclAssignment {
  /** Tokens as lib/acl writes them: "public" | "user:<id>" | "group:<g>". */
  tokens: string[];
  visibility: "public" | "group" | "multi-group" | "owner-only" | "user-shared";
}

/**
 * Assign visibility to one document.
 *
 * The mix is deliberate: a majority public so the corpus is usable by most principals, a
 * substantial group-scoped slice so authorisation actually bites, and a small private tail that
 * makes "the best answer is invisible to you" a real case rather than a hypothetical.
 */
export function assignAcl(rng: Rng, doc: SaasDoc, domain: string): AclAssignment {
  const owning = GROUPS.includes(DOMAIN_GROUP[domain] as Group)
    ? (DOMAIN_GROUP[domain] as Group)
    : "engineering";

  // Security and billing postmortems are the material a real workspace restricts hardest.
  const sensitive =
    (domain === "security" || domain === "billing" || domain === "authentication") &&
    (doc.docType === "postmortem" || doc.docType === "incident-report");

  const roll = rng.next();
  if (sensitive && roll < 0.75) {
    return { tokens: [`group:${owning}`], visibility: "group" };
  }
  if (roll < 0.55) return { tokens: ["public"], visibility: "public" };
  if (roll < 0.8) return { tokens: [`group:${owning}`], visibility: "group" };
  if (roll < 0.9) {
    const second = rng.pick(GROUPS.filter((g) => g !== owning));
    return { tokens: [`group:${owning}`, `group:${second}`], visibility: "multi-group" };
  }
  if (roll < 0.96) return { tokens: [`user:${rng.pick(PRINCIPALS).id}`], visibility: "user-shared" };
  return { tokens: [`user:${rng.pick(PRINCIPALS).id}`], visibility: "owner-only" };
}

/** Can this principal see this document? Mirrors the `terms` filter lib/retrieve applies. */
export function canSee(principal: Principal, tokens: string[]): boolean {
  const mine = new Set<string>(["public", `user:${principal.id}`, ...principal.groups.map((g) => `group:${g}`)]);
  return tokens.some((t) => mine.has(t));
}
