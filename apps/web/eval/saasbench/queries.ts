/**
 * Query realisation and relevance judgments.
 *
 * Queries are built from the scenario's *user-side* vocabulary and from identifiers. They never
 * borrow a phrase a document used, which is what forces retrieval to bridge a lexical gap instead
 * of matching planted tokens. The one intentional exception is the `identifier` class, where an
 * exact token match is the whole point — and it is scored as its own class so that its easiness can
 * never hide inside an average.
 *
 * ## Grading policy
 *
 *   3  the authoritative document for this question shape, from the target scenario
 *   2  another document of the target scenario — supporting, but not where the answer lives
 *   0  everything else, INCLUDING the target's hard negatives and same-fault peers
 *
 * Grade 1 was tried for same-fault peers and removed after measurement; see `gradeFor`.
 *
 * Grading hard negatives 0 is a judgment worth defending. A document about the same fault on a
 * different platform is arguably marginally relevant, and a human labeller might give it 1. It is
 * scored 0 here because the query names the platform, so retrieving the sibling is a discrimination
 * failure rather than a partial success — and because the entire purpose of those documents is to
 * separate strategies that can carry a constraint through ranking from strategies that match topic.
 * Reasonable people would grade this differently, which is why it is written down.
 */
import type { Rng } from "./rng";
import type { Scenario } from "./scenarios";
import { AUTHORITATIVE, type SaasDoc } from "./documents";
import { canSee, PRINCIPALS, type Principal } from "./acl";

export type QueryClass =
  | "identifier"
  | "paraphrase"
  | "troubleshooting"
  | "numeric"
  | "version"
  | "multi-document"
  | "ambiguous"
  | "hard-negative"
  | "permission-sensitive"
  | "unanswerable";

export interface SaasQuery {
  id: string;
  text: string;
  queryClass: QueryClass;
  split: "tune" | "test";
  targetScenarioId: string | null;
  /** documentId -> grade. Empty for unanswerable. */
  qrels: Record<string, number>;
  /** Set for permission-sensitive queries. */
  principal?: string;
  /** Graded relevance restricted to what the principal may see. */
  authorizedQrels?: Record<string, number>;
  /** Documents that are relevant but forbidden — must never appear at any stage. */
  forbidden?: string[];
}

/** Documents belonging to a scenario, indexed once. */
function byScenario(docs: SaasDoc[]): Map<string, SaasDoc[]> {
  const m = new Map<string, SaasDoc[]>();
  for (const d of docs) {
    const list = m.get(d.scenarioId);
    if (list) list.push(d);
    else m.set(d.scenarioId, [d]);
  }
  return m;
}

/**
 * Grades cover the target scenario ONLY.
 *
 * An earlier revision also gave grade 1 to every document of every scenario sharing the concept,
 * on the theory that same-fault material is partial credit. Measured, that was a mistake twice
 * over. It inflated the relevant set to a median of 72 documents per query, which caps Recall@5 at
 * about 7% by construction and reports a grading choice as a retrieval failure. And it is wrong on
 * the merits: a query that names its service is asking about one incident, so the same fault on a
 * different service is not partially right, it is the near-miss the hard negatives exist to test.
 */
function gradeFor(
  target: Scenario,
  queryClass: QueryClass,
  docsOf: Map<string, SaasDoc[]>,
  supersededOf?: Map<string, Scenario[]>,
): Record<string, number> {
  const qrels: Record<string, number> = {};
  const authoritative = AUTHORITATIVE[queryClass] ?? "runbook";
  for (const d of docsOf.get(target.id) ?? []) {
    qrels[d.id] = d.docType === authoritative ? 3 : 2;
  }
  // A superseded revision documents the SAME incident with guidance that has since been replaced.
  // It shares the incident's service and platform, so no anchored query can rank it below the
  // current revision, and scoring it zero charges the retriever for a distinction the query never
  // expressed. Partial credit: relevant material, not the authoritative answer.
  for (const stale of supersededOf?.get(target.id) ?? []) {
    for (const d of docsOf.get(stale.id) ?? []) qrels[d.id] = Math.max(qrels[d.id] ?? 0, 1);
  }
  return qrels;
}

/**
 * Ambiguous queries name a symptom without the attributes that would pin it to one incident, so
 * every scenario sharing the concept is a legitimate answer. Graded 2 across the board rather than
 * 3: no single document is *the* answer, which is what makes the query ambiguous.
 */
function ambiguousGrades(peers: Scenario[], docsOf: Map<string, SaasDoc[]>): Record<string, number> {
  const qrels: Record<string, number> = {};
  for (const p of peers) {
    for (const d of docsOf.get(p.id) ?? []) {
      if (d.docType === "runbook" || d.docType === "postmortem") qrels[d.id] = 2;
      else qrels[d.id] = 1;
    }
  }
  return qrels;
}

/**
 * Every frame carries an entity anchor — the service, and often the platform.
 *
 * Without one the query is not hard, it is unanswerable. Around eight core scenarios share each
 * concept and draw their root cause from the same handful of phrasings, so "my phone freezes while
 * I am writing a note" identifies no particular incident and no retriever can be right. The anchor
 * makes exactly one scenario correct while leaving the *diagnosis* — symptom to root cause — as
 * genuine work, because those two vocabularies remain disjoint. Service and platform names are
 * entities, and like identifiers they are meant to match lexically.
 */
const TROUBLE_FRAMES = [
  (sym: string, svc: string, plat: string) => `${sym} on ${plat}. What should I look at in ${svc}?`,
  (sym: string, svc: string, plat: string) => `Users on ${plat} are telling us ${sym}. Where do we start with ${svc}?`,
  (sym: string, svc: string, plat: string) => `${sym} — is this something on your side in ${svc}?`,
];
const NUMERIC_FRAMES = [
  (unit: string, svc: string) => `How much ${unit} are we allowed on ${svc}?`,
  (unit: string, svc: string) => `What is the current ceiling for ${unit} on ${svc}?`,
];
// Anchored on service AND platform, like the other natural-language classes. Anchoring on service
// alone left roughly nine core scenarios plus their same-service siblings as candidates, so these
// two classes were under-specified relative to paraphrase and troubleshooting — which is precisely
// where they sat, at 0.034-0.100 against paraphrase's 0.214.
const VERSION_FRAMES = [
  (sym: string, svc: string, plat: string) => `Which build of ${svc} sorted out the problem where ${sym} on ${plat}?`,
  (sym: string, svc: string, plat: string) => `What release of ${svc} do we need so that ${sym} stops on ${plat}?`,
];

export function generateQueries(
  rng: Rng,
  core: Scenario[],
  hardNegatives: Scenario[],
  docs: SaasDoc[],
): SaasQuery[] {
  const docsOf = byScenario(docs);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const supersededOf = new Map<string, Scenario[]>();
  for (const hn of hardNegatives) {
    if (!hn.supersededBy) continue;
    const list = supersededOf.get(hn.supersededBy);
    if (list) list.push(hn);
    else supersededOf.set(hn.supersededBy, [hn]);
  }
  const peersByConcept = new Map<string, Scenario[]>();
  for (const s of core) {
    const list = peersByConcept.get(s.conceptId);
    if (list) list.push(s);
    else peersByConcept.set(s.conceptId, [s]);
  }

  const out: SaasQuery[] = [];
  let n = 0;
  const nextId = () => `Q-${String(++n).padStart(5, "0")}`;
  // Split assignment is a deterministic draw per query, fixed once and frozen with the snapshot.
  const splitRng = rng.fork("split");
  const split = (): "tune" | "test" => (splitRng.next() < 0.2 ? "tune" : "test");

  for (const s of core) {
    const peers = peersByConcept.get(s.conceptId) ?? [s];

    // Exact identifier — the one class where lexical overlap is intended. ONE per scenario: an
    // earlier revision emitted both the error code and the incident id, which made exact-ID lookup
    // 30% of the whole benchmark and dragged the dense leg's aggregate below the gate floor on
    // class composition alone. A real workload asks far more natural-language questions than it
    // does identifier lookups.
    out.push({
      // The incident id, not the error code. Codes are drawn from small per-domain families and
      // 147 of 150 core scenarios end up sharing one with a sibling — up to six scenarios per code
      // — so a bare code query had several equally-correct targets and exactly one graded relevant.
      // That is not a lexical-matching test, it is an unresolvable choice, and it held the class to
      // 0.189 for BM25 when an exact-token lookup should be its strongest case.
      id: nextId(), text: s.id, queryClass: "identifier", split: split(),
      targetScenarioId: s.id, qrels: gradeFor(s, "identifier", docsOf, supersededOf),
    });
    // Paraphrase — pure user voice, no shared surface with any document.
    out.push({
      id: nextId(), text: `${s.symptom} — ${s.service} on ${s.platform}`, queryClass: "paraphrase", split: split(),
      targetScenarioId: s.id, qrels: gradeFor(s, "paraphrase", docsOf, supersededOf),
    });

    out.push({
      id: nextId(), text: rng.pick(TROUBLE_FRAMES)(s.symptom, s.service, s.platform), queryClass: "troubleshooting",
      split: split(), targetScenarioId: s.id, qrels: gradeFor(s, "troubleshooting", docsOf, supersededOf),
    });

    out.push({
      id: nextId(), text: rng.pick(NUMERIC_FRAMES)(s.quantity.unit, s.service),
      queryClass: "numeric", split: split(), targetScenarioId: s.id,
      qrels: gradeFor(s, "numeric", docsOf, supersededOf),
    });

    out.push({
      id: nextId(), text: rng.pick(VERSION_FRAMES)(s.symptom, s.service, s.platform), queryClass: "version",
      split: split(), targetScenarioId: s.id, qrels: gradeFor(s, "version", docsOf, supersededOf),
    });

    out.push({
      id: nextId(),
      // Deliberately NOT the incident id. Naming it made this an identifier query in disguise —
      // BM25 scored 0.608 and the dense leg 0.023, which measured the presence of a primary key
      // rather than the ability to combine a cause with the release that resolved it.
      text: `What is behind ${s.symptom} on ${s.service} for ${s.platform}, and which release put it right?`,
      queryClass: "multi-document", split: split(), targetScenarioId: s.id,
      qrels: gradeFor(s, "multi-document", docsOf, supersededOf),
    });

    // Hard negative — names the discriminating attribute, so siblings must be rejected.
    out.push({
      id: nextId(),
      text: `${s.symptom} — specifically on ${s.platform} for ${s.service}`,
      queryClass: "hard-negative", split: split(), targetScenarioId: s.id,
      qrels: gradeFor(s, "hard-negative", docsOf, supersededOf),
    });
  }

  // Ambiguous: one per concept, not per scenario — the whole point is that it does not resolve.
  for (const [conceptId, peers] of peersByConcept) {
    if (peers.length < 2) continue;
    out.push({
      id: nextId(), text: `${rng.pick(peers).goal} — anything in ${peers[0].domain}?`,
      queryClass: "ambiguous", split: split(),
      targetScenarioId: null, qrels: ambiguousGrades(peers, docsOf),
    });
    void conceptId;
  }

  // Permission-sensitive: pose a query to a principal for whom some relevant documents are
  // invisible. Scored against the authorized set, with the invisible ones recorded as forbidden.
  const permRng = rng.fork("permissions");
  for (const s of permRng.sample(core, Math.max(1, Math.floor(core.length * 0.4)))) {
    const peers = peersByConcept.get(s.conceptId) ?? [s];
    const qrels = gradeFor(s, "troubleshooting", docsOf, supersededOf);
    const principal: Principal = permRng.pick(PRINCIPALS);

    const authorized: Record<string, number> = {};
    const forbidden: string[] = [];
    for (const [docId, grade] of Object.entries(qrels)) {
      const d = docById.get(docId);
      if (d && canSee(principal, d.acl)) authorized[docId] = grade;
      else forbidden.push(docId);
    }
    // Only interesting when authorisation actually removes something.
    if (forbidden.length === 0) continue;

    out.push({
      id: nextId(),
      text: rng.pick(TROUBLE_FRAMES)(s.symptom, s.service, s.platform),
      queryClass: "permission-sensitive",
      split: split(),
      targetScenarioId: s.id,
      qrels,
      principal: principal.id,
      authorizedQrels: authorized,
      forbidden,
    });
  }

  // Unanswerable: a plausible question about something the corpus does not cover. Every metric
  // that includes these must report them separately — an unanswerable query silently sitting in a
  // denominator is exactly the defect that capped the previous benchmark at 33/34.
  const UNANSWERABLE = [
    "How do I transfer ownership of a workspace to somebody outside the company?",
    "What is the refund policy for annual subscriptions paid by bank transfer?",
    "Which regions support data residency for archived attachments?",
    "How do I export an audit log of everyone who viewed a document last quarter?",
    "Can I set a different retention period for each folder?",
    "What is the maximum number of guests on a free workspace?",
    "How do I connect a self-hosted identity provider over LDAP?",
    "Is there a way to schedule a document to publish at a future date?",
  ];
  for (const text of UNANSWERABLE) {
    out.push({
      id: nextId(), text, queryClass: "unanswerable", split: split(),
      targetScenarioId: null, qrels: {},
    });
  }

  return out;
}
