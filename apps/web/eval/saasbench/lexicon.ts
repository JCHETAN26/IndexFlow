/**
 * Paired vocabularies — the anti-circularity mechanism, and the most important file here.
 *
 * The failure mode this benchmark has to avoid is generating documents and queries from one
 * template vocabulary. Do that and BM25 wins trivially, every strategy scores ~0.95, nothing is
 * distinguishable, and the benchmark measures template diversity rather than retrieval. IndexFlow
 * has already published one saturated benchmark (`R@5 = 97%` that was really 100% of attainable
 * for three strategies at once); shipping a second, self-generated one would be worse.
 *
 * So each fault Concept carries TWO disjoint vocabularies for the same underlying fact:
 *
 *   docPhrases   how an engineer writes it down in a runbook or postmortem
 *   userPhrases  how someone experiencing it describes it in a support ticket or a search box
 *
 * Documents are realised only from `docPhrases`. Queries are realised only from `userPhrases`.
 * Nothing is shared, which forces retrieval to bridge an actual lexical gap rather than match
 * planted tokens.
 *
 * "Disjoint" is not left as an intention. `assertLexiconDisjoint()` tokenises both sides, drops
 * stopwords, and fails if any content word appears in both — and it runs as a unit test, so a
 * later edit that drifts a word across the boundary breaks the build instead of quietly inflating
 * a score. Identifiers (`ERR_*`, `INC-*`, versions) are exempt by design: exact-identifier queries
 * are *supposed* to be lexical matches, and they are scored as their own query class so their
 * easiness never hides in an average.
 */

export interface Concept {
  id: string;
  /** Coarse area, used for hard-negative construction and for the `1` grade in qrels. */
  domain: string;
  /** Engineering-voice descriptions of the fault. Documents draw from these only. */
  docPhrases: readonly string[];
  /** User-voice descriptions of the same fault. Queries draw from these only. */
  userPhrases: readonly string[];
  /** Engineering-voice statements of the fix. */
  docFixes: readonly string[];
  /** User-voice statements of what they want to happen. */
  userGoals: readonly string[];
}

export const CONCEPTS: readonly Concept[] = [
  {
    id: "editor-autosave-debounce",
    domain: "editor",
    docPhrases: [
      "the periodic persistence timer began firing at a far shorter interval than configured",
      "the debounce window collapsed toward zero, so each keystroke enqueued a separate write",
      "write coalescing stopped applying and every character change produced its own request",
    ],
    userPhrases: [
      "typing stutters and pauses every couple of seconds",
      "my phone freezes while I am writing a note",
      "words show up late when I type quickly on mobile",
    ],
    docFixes: [
      "restore the coalescing interval to 750 milliseconds",
      "reinstate the timer threshold that batching depends on",
    ],
    userGoals: ["get typing to feel smooth again", "stop the app hanging mid-sentence"],
  },
  {
    id: "auth-token-expiry",
    domain: "authentication",
    docPhrases: [
      "bearer credentials reached the end of their validity window and were not renewed",
      "the refresh exchange returned an invalid grant, leaving the principal unauthenticated",
      "credential lifetime elapsed mid-session because renewal was never scheduled",
    ],
    userPhrases: [
      "I keep getting signed out after about an hour",
      "it forgets who I am and asks me to log in again",
      "my session drops in the middle of what I am doing",
    ],
    docFixes: [
      "schedule renewal at eighty percent of the validity window",
      "exchange the long-lived credential before the window elapses",
    ],
    userGoals: ["stay logged in for a full working day", "stop being kicked out mid-task"],
  },
  {
    id: "db-pool-exhaustion",
    domain: "database",
    docPhrases: [
      "every available connection was checked out, so further statements queued behind the pool",
      "the pool reached its ceiling and acquisition waits grew without bound",
      "connection checkout blocked because none were returned quickly enough",
    ],
    userPhrases: [
      "pages hang for ages when lots of people are online",
      "everything crawls at busy times of day",
      "the site stalls and then eventually gives up",
    ],
    docFixes: [
      "lower the ceiling to thirty and shorten statement timeouts",
      "return connections promptly and cap acquisition waits",
    ],
    userGoals: ["keep the site responsive during busy hours", "stop pages stalling under load"],
  },
  {
    id: "search-upstream-timeout",
    domain: "search",
    docPhrases: [
      "the downstream ranking service exceeded its deadline and the gateway abandoned the call",
      "query fan-out did not return within the allotted budget",
      "the ranking tier stopped answering inside the deadline under sustained fan-out",
    ],
    userPhrases: [
      "looking things up just spins and never finishes",
      "finding a document times out when the team is busy",
      "the magnifying glass box gives up on me",
    ],
    docFixes: [
      "raise the deadline and shed load above the configured budget",
      "cap fan-out breadth so the tier answers inside its deadline",
    ],
    userGoals: ["be able to look things up reliably", "stop lookups giving up halfway"],
  },
  {
    id: "webhook-retry-storm",
    domain: "webhooks",
    docPhrases: [
      "failed deliveries were re-attempted without backoff, multiplying outbound volume",
      "the re-attempt schedule collapsed to a fixed short delay and amplified traffic",
      "receivers were hammered because the escalating delay was never applied",
    ],
    userPhrases: [
      "our endpoint is getting hit over and over with the same event",
      "we received the same notification dozens of times",
      "the callbacks keep repeating and will not stop",
    ],
    docFixes: [
      "reinstate exponential spacing with a ceiling of six attempts",
      "space re-attempts by an escalating delay and stop after six",
    ],
    userGoals: ["only get told once about each thing", "stop the duplicate callbacks"],
  },
  {
    id: "billing-charge-decline",
    domain: "billing",
    docPhrases: [
      "the charge instrument was refused by the issuer for insufficient funds",
      "settlement failed and the dunning sequence began",
      "the issuer refused authorisation, moving the workspace into arrears handling",
    ],
    userPhrases: [
      "my card was turned down but there is money in the account",
      "we got an email saying the invoice did not go through",
      "the subscription says it could not take payment",
    ],
    docFixes: [
      "re-present the instrument after three days and notify the billing contact",
      "retry settlement on a fixed schedule before suspending the workspace",
    ],
    userGoals: ["get the invoice paid without losing access", "sort out the rejected payment"],
  },
  {
    id: "upload-thumbnail-pipeline",
    domain: "uploads",
    docPhrases: [
      "derivative generation lagged because the transform workers were saturated",
      "resized variants were produced far behind the originals under burst load",
      "the transform stage queued behind a backlog and preview assets arrived late",
    ],
    userPhrases: [
      "the tiny versions of my pictures take forever to appear",
      "images stay blank for minutes after I add them",
      "photos I attached are not showing a small version yet",
    ],
    docFixes: [
      "scale the transform tier and prioritise the smallest derivative first",
      "give preview assets their own queue ahead of larger variants",
    ],
    userGoals: ["see my pictures straight after adding them", "stop waiting for previews"],
  },
  {
    id: "storage-quota-exceeded",
    domain: "storage",
    docPhrases: [
      "the workspace consumed its allotted capacity and further writes were refused",
      "allocation reached its ceiling so new objects were rejected at admission",
      "capacity accounting reported the tenant over its allowance and blocked writes",
    ],
    userPhrases: [
      "it will not let me add anything new to my team space",
      "I am told there is no room left for more files",
      "adding a file fails saying we are full",
    ],
    docFixes: [
      "raise the allowance or purge objects past the retention horizon",
      "expire old objects to bring the tenant under its allowance",
    ],
    userGoals: ["be able to add files again", "free up room in our team space"],
  },
  {
    id: "export-csv-streaming",
    domain: "exports",
    docPhrases: [
      "the extract accumulated the complete result in memory before emitting a byte",
      "buffering the full set exhausted the heap on large tenants",
      "the extract path materialised every row before writing, and was killed on large tenants",
    ],
    userPhrases: [
      "downloading our whole table just dies partway",
      "the spreadsheet download never completes for big teams",
      "pulling everything out to a file fails silently",
    ],
    docFixes: [
      "emit each row incrementally to the response instead of accumulating them",
      "write the extract as it is produced rather than materialising it",
    ],
    userGoals: ["get the whole table out as a file", "download all our rows without it dying"],
  },
  {
    id: "realtime-merge-conflict",
    domain: "collaboration",
    docPhrases: [
      "concurrent revisions converged incorrectly when operations arrived out of sequence",
      "the convergence algorithm mis-ordered simultaneous revisions from two participants",
      "simultaneous revisions were reconciled in the wrong order and content was dropped",
    ],
    userPhrases: [
      "my colleague and I overwrote each other's sentences",
      "text disappeared when two of us were working at once",
      "our changes clobbered each other in the shared doc",
    ],
    docFixes: [
      "order operations by their logical clock before reconciling",
      "reconcile revisions by sequence rather than arrival time",
    ],
    userGoals: ["stop losing text when we work together", "have both our edits survive"],
  },
  {
    id: "deploy-migration-lock",
    domain: "deployment",
    docPhrases: [
      "the schema migration acquired an exclusive lock and blocked reads throughout",
      "the rollout held a table-level lock whilst rewriting, stalling live traffic",
      "an exclusive lock held across the rewrite made the table unavailable to serving paths",
    ],
    userPhrases: [
      "the whole product went down during your update last night",
      "nothing loaded for twenty minutes while you were pushing a change",
      "we had an outage right when you shipped something",
    ],
    docFixes: [
      "rewrite in batches without holding an exclusive lock",
      "apply the migration concurrently so serving paths continue reading",
    ],
    userGoals: ["not have outages when you ship", "stay up during your updates"],
  },
  {
    id: "cache-stale-invalidation",
    domain: "caching",
    docPhrases: [
      "invalidation messages were dropped, so superseded entries continued to be served",
      "the eviction signal never reached every replica and outdated copies persisted",
      "replicas retained superseded entries because the purge broadcast was lost",
    ],
    userPhrases: [
      "I changed the title but it still shows the old one",
      "my edit does not appear until I hard refresh",
      "other people still see the previous version of what I fixed",
    ],
    docFixes: [
      "broadcast purges with acknowledgement and reconcile on a timer",
      "confirm eviction across replicas rather than firing and forgetting",
    ],
    userGoals: ["see my change straight away", "have everyone see the current version"],
  },
  {
    id: "queue-worker-starvation",
    domain: "queues",
    docPhrases: [
      "long-running items monopolised every consumer, leaving short work unclaimed",
      "consumers were occupied by heavyweight items so light work waited indefinitely",
      "the shared consumer pool was held by slow items and lightweight work went unclaimed",
    ],
    userPhrases: [
      "small background things never seem to finish",
      "quick jobs sit waiting behind something enormous",
      "my little task has been pending for hours",
    ],
    docFixes: [
      "give heavyweight items a dedicated pool with its own concurrency",
      "separate slow work onto its own consumers",
    ],
    userGoals: ["have quick jobs finish quickly", "stop small tasks waiting forever"],
  },
  {
    id: "notification-fanout-duplicate",
    domain: "notifications",
    docPhrases: [
      "the dispatch record was written after sending, so a crash re-sent the message",
      "delivery was not idempotent and a retry produced a second message",
      "the sent marker committed after transmission, allowing duplicates after a restart",
    ],
    userPhrases: [
      "everyone on my team got the same email twice",
      "we were pinged about one comment three separate times",
      "the same alert arrived repeatedly",
    ],
    docFixes: [
      "record the dispatch marker before transmitting and key it uniquely",
      "make delivery idempotent against a stable key",
    ],
    userGoals: ["only be told once", "stop the repeated emails"],
  },
  {
    id: "secrets-rotation-outage",
    domain: "security",
    docPhrases: [
      "the superseded credential was withdrawn before every consumer had adopted the replacement",
      "revocation preceded full propagation and callers were left holding a withdrawn secret",
      "the old value was invalidated while some services still presented it",
    ],
    userPhrases: [
      "our integration suddenly stopped working this morning",
      "the connection to your service broke with no warning",
      "everything using our key started failing at once",
    ],
    docFixes: [
      "overlap both values until adoption is confirmed, then withdraw the old one",
      "withdraw the superseded value only after every consumer reports the replacement",
    ],
    userGoals: ["keep our integration working through a key change", "not break when keys change"],
  },
  {
    id: "feature-flag-partial-rollout",
    domain: "release",
    docPhrases: [
      "the gate evaluated inconsistently across replicas, so a session saw both variants",
      "targeting was computed per request rather than pinned, producing a flapping experience",
      "the toggle resolved differently on each replica because assignment was not sticky",
    ],
    userPhrases: [
      "the new layout appears and disappears as I click around",
      "half my team sees one thing and half sees another",
      "the interface keeps switching between two designs",
    ],
    docFixes: [
      "pin assignment to a stable identifier so a session resolves consistently",
      "compute targeting once per session rather than per request",
    ],
    userGoals: ["get a consistent interface", "stop the layout changing under me"],
  },
  {
    id: "observability-blind-spot",
    domain: "observability",
    docPhrases: [
      "sampling discarded the traces covering the degraded path, hiding it from dashboards",
      "the instrumentation omitted the failing span so latency appeared nominal",
      "aggregated percentiles concealed a slow path because its traces were sampled away",
    ],
    userPhrases: [
      "you told us everything was fine while we were clearly broken",
      "your status page said healthy during our worst hour",
      "nobody noticed we were struggling for two days",
    ],
    docFixes: [
      "retain traces for degraded outcomes regardless of the sampling rate",
      "always keep spans that end in an error",
    ],
    userGoals: ["have problems noticed before we report them", "trust the health indicators"],
  },
  {
    id: "ratelimit-shared-bucket",
    domain: "api",
    docPhrases: [
      "the allowance was keyed per tenant rather than per credential, so one caller starved the rest",
      "a single aggressive consumer drained the shared allowance for the whole account",
      "budget accounting grouped callers together and one drained the remainder",
    ],
    userPhrases: [
      "one of our scripts is blocking everyone else on the team",
      "we get refused even though only one tool is busy",
      "our other integrations stop working when one gets heavy",
    ],
    docFixes: [
      "key the allowance per credential and reserve a floor for each",
      "account for budget per caller rather than per account",
    ],
    userGoals: ["stop one tool starving the others", "keep our other integrations working"],
  },
];

/** Words too common to count as evidence of lexical leakage. */
const STOPWORDS = new Set(
  ("a an and are as at be been before but by can did do does for from had has have how i if in into is it its me " +
    "my no not of on one only or our out over so than that the their them then there these they this to two up " +
    "was we were what when where which while who why will with without you your it's we're i'm us get got make " +
    "made just still keep keeps stop stops start starts every each some any all more most much many other others " +
    "same own new old first last next own after again back down off under between both few own very now once")
    .split(/\s+/),
);

/** Identifiers are meant to match lexically; they are exempt and scored as their own class. */
const IDENTIFIER = /^(err_|inc-|dep-|pay-|v?\d)/i;

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !IDENTIFIER.test(w));
}

export interface LeakReport {
  conceptId: string;
  shared: string[];
}

/**
 * Every content word used on the document side of a Concept must be absent from its query side.
 *
 * This is the invariant that makes the benchmark worth running. A violation means queries and
 * documents share surface form for the same fact, which is precisely the circularity that would
 * make BM25 look brilliant and the benchmark meaningless.
 */
export function findLexiconLeaks(concepts: readonly Concept[] = CONCEPTS): LeakReport[] {
  const leaks: LeakReport[] = [];
  for (const c of concepts) {
    const docSide = new Set([...c.docPhrases, ...c.docFixes].flatMap(contentWords));
    const userSide = new Set([...c.userPhrases, ...c.userGoals].flatMap(contentWords));
    const shared = [...docSide].filter((w) => userSide.has(w)).sort();
    if (shared.length > 0) leaks.push({ conceptId: c.id, shared });
  }
  return leaks;
}

export function assertLexiconDisjoint(concepts: readonly Concept[] = CONCEPTS): void {
  const leaks = findLexiconLeaks(concepts);
  if (leaks.length === 0) return;
  const detail = leaks.map((l) => `  ${l.conceptId}: ${l.shared.join(", ")}`).join("\n");
  throw new Error(
    `[saasbench] document and query vocabularies overlap, which would make the benchmark ` +
      `self-fulfilling:\n${detail}\n` +
      `Reword one side, or add the word to STOPWORDS only if it genuinely carries no signal.`,
  );
}
