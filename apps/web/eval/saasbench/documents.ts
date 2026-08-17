/**
 * Document realisation — engineering voice only.
 *
 * ## The support-ticket decision, stated rather than buried
 *
 * A real SaaS knowledge base contains user-voice support tickets, and the remediation brief asks
 * for 15K of them. They are deliberately NOT generated in user voice here, and the reason is the
 * circularity this benchmark exists to avoid: a ticket realised from the same `userPhrases` a query
 * is realised from would contain the query almost verbatim. BM25 would then score brilliantly on a
 * match the generator planted, and the benchmark would measure its own templates.
 *
 * So tickets are written as an agent's summary in engineering voice — "the reporter describes …"
 * followed by document-side phrasing. The consequence is worth being explicit about: **this corpus
 * is harder than a real one.** A real knowledge base has user-voice text sitting lexically close to
 * user queries, and retrieval scores here will therefore understate what the same system would
 * achieve in production. That is the conservative direction to err, and it is recorded in the claim
 * ledger rather than left for a reader to infer.
 *
 * Fixing this properly means a third vocabulary — colloquial, disjoint from both existing sides —
 * so tickets can be user-voice without being query-voice. That is real authoring work and is left
 * as a stated gap.
 *
 * ## Formats
 *
 * Markdown, plain text and CSV are emitted because the ingestion pipeline handles them. PDF is
 * supported by the pipeline but is not generated here: producing valid PDFs would add a dependency
 * for no retrieval signal, since extraction yields the same text either way.
 */
import type { Rng } from "./rng";
import type { Scenario } from "./scenarios";

export type DocType =
  | "incident-report"
  | "postmortem"
  | "runbook"
  | "release-notes"
  | "standup-notes"
  | "product-spec"
  | "api-error-doc"
  | "deployment-record"
  | "support-escalation";

export interface SaasDoc {
  id: string;
  scenarioId: string;
  docType: DocType;
  title: string;
  body: string;
  fileType: "md" | "txt" | "csv";
  /** ACL principal tokens, assigned in acl.ts. */
  acl: string[];
  /** Convenience mirror of the scenario's kind, so filler can be filtered without a join. */
  scenarioKind: Scenario["kind"];
}

/** Which document type is the authoritative answer for a given question shape. */
export const AUTHORITATIVE: Record<string, DocType> = {
  identifier: "api-error-doc",
  troubleshooting: "runbook",
  paraphrase: "postmortem",
  numeric: "product-spec",
  version: "release-notes",
  "multi-document": "postmortem",
  ambiguous: "runbook",
  "hard-negative": "runbook",
};

const pad = (n: number) => String(n).padStart(5, "0");

/**
 * Additional engineering-voice narrative, so a document is long enough to chunk.
 *
 * Without this every document produced exactly **1.00 chunks**, which quietly removed the
 * production retrieval path from the benchmark: IndexFlow retrieves chunks, correlates the two legs
 * by chunk id, blends, and only then de-duplicates to documents. At one chunk per document that
 * entire mechanism is a no-op and the benchmark measures document-level retrieval instead. Real
 * runbooks and postmortems are also not 120 words long.
 *
 * The prose restates scenario context rather than padding with neutral filler. Padding identical
 * across the corpus would dilute every document equally and waste the chunk budget; restating the
 * service, build and signature carries the discriminating signal into the later chunks, which is
 * what real documents do.
 *
 * Engineering voice only — this text must never borrow from the query-side vocabulary.
 */
function narrative(s: Scenario, rng: Rng): string {
  const detection = rng.pick([
    `Detection came from the ${s.environment} signature dashboard rather than from an alert threshold. ` +
      `Volume for \`${s.errorCode}\` on ${s.service} rose steadily for several minutes before it crossed ` +
      `any configured trigger, which is why the owning team picked it up by inspection first. The ` +
      `ninety-fifth percentile for the affected path had been stable near ${s.baselineMs} ms for the ` +
      `preceding fortnight, so the departure was unambiguous once somebody looked directly at it.`,
    `The condition was first visible in the ${s.environment} traces for ${s.service}, where the share of ` +
      `spans terminating in \`${s.errorCode}\` climbed from background levels to a substantial fraction of ` +
      `traffic on ${s.platform}. Percentile latency for the same path moved off its ${s.baselineMs} ms ` +
      `baseline in the same window, which tied the two observations together without further work.`,
  ]);

  const scope = rng.pick([
    `Scope was limited to ${s.platform} callers of ${s.service} in ${s.environment}. Other client surfaces ` +
      `continued to be served normally throughout, and no adjacent component reported a correlated ` +
      `change. Traffic on builds earlier than ${s.affectedVersion} was unaffected, which localised the ` +
      `regression to that release rather than to infrastructure beneath it.`,
    `Only ${s.platform} traffic against ${s.service} was implicated. The ${s.environment} deployment carrying ` +
      `${s.affectedVersion} showed the behaviour; hosts still serving the preceding build did not, and that ` +
      `difference held for the whole period under review. Neighbouring components stayed within their ` +
      `usual bounds, so no shared dependency was implicated.`,
  ]);

  const mechanism =
    `The mechanism is worth stating precisely, because the surface symptom admits more than one ` +
    `explanation. ${s.rootCause}. With that established the observed shape follows directly: the ` +
    `ninety-fifth percentile moved from ${s.baselineMs} ms to roughly ${s.degradedMs} ms, and the ` +
    `signature raised to callers was \`${s.errorCode}\` rather than a generic failure, because the ` +
    `condition was detected inside the component rather than at its edge.`;

  const contributing = rng.pick([
    `A pair of contributing factors are recorded. The configured allowance of ${s.quantity.value} ` +
      `${s.quantity.unit} left no headroom for the additional work the regression created, so a condition ` +
      `that might have degraded gracefully instead surfaced to callers. And the change reached ` +
      `${s.environment} without a soak against representative ${s.platform} traffic, which is where the ` +
      `behaviour would have been visible before customers saw it.`,
    `The allowance for this component, ${s.quantity.value} ${s.quantity.unit}, is sized for ordinary ` +
      `operation and was consumed quickly once the regression was in place. That is a contributing ` +
      `factor rather than a cause: correcting the allowance alone would have deferred the failure ` +
      `rather than removed it. Owning team ${s.team} holds the follow-up for both.`,
  ]);

  const remediation =
    `Remediation: ${s.mitigation}. That shipped in ${s.resolvedVersion}. Verification was a return of ` +
    `the ninety-fifth percentile toward ${s.baselineMs} ms on ${s.platform}, together with signature ` +
    `volume for \`${s.errorCode}\` falling back to background. Both were confirmed in ${s.environment} ` +
    `before the incident was closed by ${s.team}.`;

  return [detection, scope, mechanism, contributing, remediation].join("\n\n");
}



function incidentReport(s: Scenario, rng: Rng): { title: string; body: string; fileType: "md" } {
  return {
    title: `${s.id} — ${s.service} degradation on ${s.platform}`,
    fileType: "md",
    body: `# ${s.id} — ${s.service} (${s.platform})

**Severity** ${s.severity}  ·  **Environment** ${s.environment}  ·  **Owning team** ${s.team}
**Signature** \`${s.errorCode}\`  ·  **Affected build** ${s.affectedVersion}

## Summary

Serving paths on ${s.service} degraded for ${s.platform} clients in ${s.environment}. The
signature raised throughout was \`${s.errorCode}\`.

## Root cause

${s.rootCause}.

## Impact

Latency at the ninety-fifth percentile moved from ${s.baselineMs} ms to ${s.degradedMs} ms while
the condition persisted. Configured allowance at the time was ${s.quantity.value} ${s.quantity.unit}.

## Mitigation

${s.mitigation}. Carried in build ${s.resolvedVersion}.

## Detail

${narrative(s, rng)}
`,
  };
}

function postmortem(s: Scenario, rng: Rng): { title: string; body: string; fileType: "md" } {
  return {
    title: `Postmortem: ${s.service} ${s.errorCode} (${s.id})`,
    fileType: "md",
    body: `# Postmortem — ${s.id}

Owning team ${s.team}. Component ${s.service}. Client surface ${s.platform}.

## What happened

${s.rootCause}. The condition surfaced to callers as \`${s.errorCode}\` and was first observed on
build ${s.affectedVersion} in ${s.environment}.

## Why it took as long as it did

The regression was inside a path whose ninety-fifth percentile normally sits near ${s.baselineMs}
ms, so the move to ${s.degradedMs} ms read as ordinary variance on the dashboards until the
signature volume was correlated against the deploy.

## Corrective action

${s.mitigation}. Shipped in ${s.resolvedVersion}. The operating allowance for this component is
${s.quantity.value} ${s.quantity.unit}.
## Detail

${narrative(s, rng)}
${s.superseded ? `\n> **Superseded.** This account is retained for history. Current guidance is in ${s.supersededBy}.\n` : ""}`,
  };
}

function runbook(s: Scenario, rng: Rng): { title: string; body: string; fileType: "md" } {
  return {
    title: `Runbook: ${s.domain} degradation on ${s.service}`,
    fileType: "md",
    body: `# Runbook — ${s.service} (${s.domain})

## When this applies

Callers on ${s.platform} receive \`${s.errorCode}\`, or the ninety-fifth percentile for
${s.service} rises materially above its usual ${s.baselineMs} ms.

## What is happening underneath

${s.rootCause}.

## Steps

1. Confirm the signature volume for \`${s.errorCode}\` against the ${s.environment} dashboard.
2. Compare the current build against ${s.affectedVersion}, which carries the defect.
3. Check the configured allowance; it should read ${s.quantity.value} ${s.quantity.unit}.
4. ${s.mitigation}.
5. Verify recovery toward ${s.baselineMs} ms before standing down.

## Background

${narrative(s, rng)}

## Escalation

Owning team is ${s.team}. Reference incident ${s.id}.
${s.superseded ? `\n> **Superseded** by ${s.supersededBy}. Do not follow these steps.\n` : ""}`,
  };
}

function releaseNotes(s: Scenario): { title: string; body: string; fileType: "md" } {
  return {
    title: `Release ${s.resolvedVersion} — ${s.service}`,
    fileType: "md",
    body: `# ${s.resolvedVersion}

## Fixed

- **${s.service}** — ${s.mitigation}. Resolves the condition tracked as ${s.id}, which surfaced as
  \`${s.errorCode}\` for ${s.platform} clients from ${s.affectedVersion} onward.

## Notes

The operating allowance for ${s.service} remains ${s.quantity.value} ${s.quantity.unit}.
Owning team ${s.team}.
`,
  };
}

function standupNotes(s: Scenario, rng: Rng): { title: string; body: string; fileType: "md" } {
  const day = rng.int(1, 28);
  return {
    title: `${s.team} standup — day ${day}`,
    fileType: "md",
    body: `# ${s.team} — standup notes

## Day ${day}

- Still on ${s.id}. ${s.rootCause}. Signature is \`${s.errorCode}\` on ${s.platform}.
- Fix is landing in ${s.resolvedVersion}: ${s.mitigation}.
- ${s.service} ninety-fifth percentile back toward ${s.baselineMs} ms once that ships.
- Reminder: allowance for this component is ${s.quantity.value} ${s.quantity.unit}.
`,
  };
}

function productSpec(s: Scenario, rng: Rng): { title: string; body: string; fileType: "md" } {
  return {
    title: `${s.service} — operating limits and behaviour`,
    fileType: "md",
    body: `# ${s.service} — specification

## Allowance

The configured allowance for ${s.service} is **${s.quantity.value} ${s.quantity.unit}**. Exceeding
it raises \`${s.errorCode}\` to the caller.

## Expected performance

The ninety-fifth percentile target for this component is ${s.baselineMs} ms on ${s.platform}.

## Known failure mode

${s.rootCause}. Handled by: ${s.mitigation}.

Owning team ${s.team}. Current from build ${s.resolvedVersion}.

## Detail

${narrative(s, rng)}
`,
  };
}

function apiErrorDoc(s: Scenario): { title: string; body: string; fileType: "txt" } {
  return {
    title: `Error reference: ${s.errorCode}`,
    fileType: "txt",
    body: `${s.errorCode}

Component: ${s.service}
Surface: ${s.platform}
Owning team: ${s.team}

Meaning
  ${s.rootCause}.

Operator action
  ${s.mitigation}.

Allowance
  ${s.quantity.value} ${s.quantity.unit}.

First observed in build ${s.affectedVersion}; addressed in ${s.resolvedVersion}.
Related incident: ${s.id}.
`,
  };
}

function deploymentRecord(s: Scenario, rng: Rng): { title: string; body: string; fileType: "csv" } {
  const dep = `DEP-${pad(rng.int(1000, 9999))}`;
  return {
    title: `Deployment ${dep} — ${s.service}`,
    fileType: "csv",
    body: `deployment,service,build,environment,platform,outcome,incident,signature,allowance
${dep},${s.service},${s.affectedVersion},${s.environment},${s.platform},regressed,${s.id},${s.errorCode},${s.quantity.value} ${s.quantity.unit}
${dep}-r,${s.service},${s.resolvedVersion},${s.environment},${s.platform},recovered,${s.id},${s.errorCode},${s.quantity.value} ${s.quantity.unit}
`,
  };
}

/**
 * Agent-written summary of a report. Engineering voice by construction — see the header note on
 * why this is not written the way a customer would write it.
 */
function supportEscalation(s: Scenario, rng: Rng): { title: string; body: string; fileType: "txt" } {
  const ticket = `TS-${pad(rng.int(10000, 99999))}`;
  return {
    title: `Escalation ${ticket} — ${s.service} on ${s.platform}`,
    fileType: "txt",
    body: `Escalation ${ticket}
Component: ${s.service}   Surface: ${s.platform}   Environment: ${s.environment}

Agent summary
  The reporter's account is consistent with the following: ${s.rootCause}. The signature returned
  to the caller was ${s.errorCode}, on build ${s.affectedVersion}.

Verification
  Allowance confirmed at ${s.quantity.value} ${s.quantity.unit}. Latency observed near
  ${s.degradedMs} ms against a ${s.baselineMs} ms target.

Resolution offered
  ${s.mitigation}. Available from ${s.resolvedVersion}.

Investigation notes
  ${narrative(s, rng)}

Linked incident: ${s.id}. Routed to ${s.team}.
`,
  };
}

const BUILDERS: Record<DocType, (s: Scenario, rng: Rng) => { title: string; body: string; fileType: SaasDoc["fileType"] }> = {
  "incident-report": (s, r) => incidentReport(s, r),
  postmortem: (s, r) => postmortem(s, r),
  runbook: (s, r) => runbook(s, r),
  "release-notes": (s) => releaseNotes(s),
  "standup-notes": (s, r) => standupNotes(s, r),
  "product-spec": (s, r) => productSpec(s, r),
  "api-error-doc": (s) => apiErrorDoc(s),
  "deployment-record": (s, r) => deploymentRecord(s, r),
  "support-escalation": (s, r) => supportEscalation(s, r),
};

/**
 * Core scenarios get the full document set, so every question shape has an authoritative target.
 * Near-misses and filler get a subset — a corpus where every incident is documented identically is
 * a regularity a retriever can exploit without understanding anything.
 */
const CORE_TYPES: DocType[] = [
  "incident-report", "postmortem", "runbook", "release-notes",
  "product-spec", "api-error-doc", "standup-notes", "support-escalation", "deployment-record",
];
const SIBLING_TYPES: DocType[] = [
  "incident-report", "runbook", "release-notes", "api-error-doc", "product-spec", "support-escalation",
];
const FILLER_TYPES: DocType[] = [
  "incident-report", "standup-notes", "deployment-record", "support-escalation", "runbook",
];

export function realiseDocuments(rng: Rng, scenarios: Scenario[]): SaasDoc[] {
  const docs: SaasDoc[] = [];
  for (const s of scenarios) {
    const pool =
      s.kind === "core" ? CORE_TYPES : s.kind === "hard-negative" ? SIBLING_TYPES : FILLER_TYPES;
    const types = s.kind === "core" ? pool : rng.sample(pool, rng.int(2, Math.min(4, pool.length)));
    for (const t of types) {
      const built = BUILDERS[t](s, rng);
      docs.push({
        id: `${s.id}-${t}`,
        scenarioId: s.id,
        docType: t,
        title: built.title,
        body: built.body,
        fileType: built.fileType,
        acl: [],
        scenarioKind: s.kind,
      });
    }
  }
  return docs;
}
