# IndexFlow — High-Value Engineering Remediation

## Mission

Upgrade IndexFlow from a strong permission-aware hybrid-search implementation into a **rigorously benchmarked, failure-tested, end-to-end validated search system** with defensible evidence for both:

* Software Engineer / Backend Engineer / SDE applications
* AI Engineer / Search Engineer / ML Systems applications

This remediation is not a resume-number-generation exercise.

The implementation must first make the system technically stronger. Resume metrics may only be derived from reproducible benchmark and test evidence produced by the repository.

The final system should demonstrate four independent engineering properties:

1. **Retrieval quality** — sparse, dense, and hybrid retrieval evaluated on a controlled SaaS-domain benchmark.
2. **Scale and performance** — ingestion and search behavior measured from 1K through 100K documents.
3. **Permission correctness** — unauthorized content never enters candidate ranking or downstream generation.
4. **Distributed consistency and recovery** — permission/content changes survive stale events, outages, crashes, retries, and index drift.

---

# 1. Existing IndexFlow Architecture

IndexFlow currently includes:

* Next.js 15
* React 19
* TypeScript strict mode
* PostgreSQL
* pgvector
* Elasticsearch
* Prisma
* Redis
* BullMQ
* MinIO
* Auth.js / JWT sessions
* local 384-dimensional ONNX MiniLM embeddings
* local Llama 3.2 3B generation
* OpenTelemetry
* Docker Compose
* GitHub Actions

Existing search architecture:

```text
                         QUERY
                           │
                    authenticated user
                     + group membership
                           │
               ┌───────────┴───────────┐
               │                       │
               ▼                       ▼
        Elasticsearch              PostgreSQL
            BM25                    pgvector
               │                       │
        ACL filter FIRST        ACL predicate FIRST
               │                       │
               ▼                       ▼
       authorized sparse       authorized dense
          candidates              candidates
               │                       │
               └──────────┬────────────┘
                          ▼
                     score fusion
                          │
                          ▼
                       ranking
                          │
                          ▼
                    grounded answer
```

PostgreSQL remains the authoritative store.

Elasticsearch is a projection synchronized through:

* transactional outbox
* asynchronous projector
* idempotent processing
* `aclVersion`
* `contentVersion`
* reconciliation / drift repair

These guarantees must not be weakened by this remediation.

---

# 2. Non-Negotiable Rules

## 2.1 No fabricated metrics

Never invent:

* throughput
* latency
* retrieval scores
* concurrency
* security results
* recovery results
* percentage improvements
* scale claims

Every metric must come from an executable benchmark or automated test.

---

## 2.2 Withdrawn claims remain withdrawn

Before implementation begins:

1. inspect all evaluation documentation;
2. locate the section listing withdrawn / invalid / superseded claims;
3. create an explicit blacklist;
4. ensure those claims cannot accidentally reappear in reports.

Claims previously identified as invalid include examples such as:

* sub-11 ms p50
* MRR 0.96
* R@5 = 97%
* reranking improves MRR 0.85 → 0.90

The repository documentation is authoritative.

---

## 2.3 Synthetic data must be identified as synthetic

The new main benchmark will use generated SaaS engineering documents.

Always describe it as one of:

* synthetic SaaS knowledge-base corpus
* generated SaaS engineering benchmark
* controlled synthetic enterprise-search workload

Never describe it as:

* real customer documents
* production enterprise data
* customer traffic
* real users

---

## 2.4 Authorization must occur before ranking

The existing security property must remain true:

> Unauthorized documents must not enter the sparse or dense candidate sets.

Forbidden architecture:

```text
retrieve
↓
rank
↓
filter unauthorized results
```

Required architecture:

```text
authorization constraint
↓
retrieve only authorized candidates
↓
rank
```

This must independently hold for:

* Elasticsearch
* PostgreSQL / pgvector

---

# 3. Phase A — Build SaaSBench-100K

Create a deterministic benchmark generator:

```text
eval/saasbench/
```

Suggested structure:

```text
eval/saasbench/
├── generator/
├── schemas/
├── templates/
├── scenarios/
├── queries/
├── qrels/
├── acl/
├── snapshots/
├── manifests/
└── reports/
```

---

# 4. SaaSBench Ground-Truth Model

Do not begin with prose.

Generate structured ground truth first.

Example:

```json
{
  "scenarioId": "INC-48291",
  "domain": "mobile-editor",
  "type": "incident",
  "service": "editor-sync",
  "symptom": "typing feels delayed on iOS",
  "rootCause": "autosave debounce regression",
  "affectedVersion": "4.18.2",
  "resolvedVersion": "4.18.3",
  "errorCode": "ERR_SYNC_429",
  "baselineP95Ms": 130,
  "degradedP95Ms": 840,
  "mitigation": "increase debounce interval to 750ms",
  "team": "mobile-platform",
  "severity": "SEV-2"
}
```

Then generate multiple documents from the same scenario.

For example:

```text
incident-report.md
support-ticket.txt
runbook.md
release-notes.md
postmortem.md
standup-notes.md
product-spec.md
```

This creates realistic cross-document redundancy while preserving known truth.

---

# 5. SaaSBench Domains

Cover realistic engineering knowledge-base domains.

At minimum:

* authentication
* authorization
* OAuth
* session/token expiry
* API errors
* API rate limiting
* webhooks
* Stripe / billing
* payment failures
* database connection pooling
* PostgreSQL tuning
* Redis
* caching
* queue workers
* deployment failures
* Kubernetes
* observability
* mobile performance
* frontend rendering
* uploads
* object storage
* search
* indexing
* realtime collaboration
* notifications
* storage quotas
* data exports
* CSV generation
* security incidents
* secrets
* CI/CD
* feature flags
* migrations
* background jobs
* service outages
* infrastructure capacity
* support escalation
* release management

---

# 6. Target Corpus

Generate exactly versioned scale snapshots.

Recommended:

```text
1,000 documents
5,000 documents
10,000 documents
25,000 documents
50,000 documents
100,000 documents
```

The snapshots must be deterministic.

Record:

```text
generator version
seed
document count
scenario count
generated timestamp
template version
schema version
content hash
```

The 100K corpus should contain enough distinct underlying scenarios that it is not simply 100K paraphrases of a few documents.

Target approximately:

```text
15K–30K structured scenarios
100K generated documents
```

depending on the resulting document-per-scenario distribution.

---

# 7. Document-Type Distribution

Use multiple realistic document types.

Example target distribution:

| Type                         | Approximate Count |
| ---------------------------- | ----------------: |
| Support tickets              |               15K |
| Incident reports             |               12K |
| Deployment/change records    |               10K |
| Runbooks                     |                8K |
| Product specifications       |                8K |
| Standup/meeting notes        |                8K |
| API/error documentation      |                7K |
| Postmortems                  |                7K |
| Search/database/storage docs |                7K |
| Auth/security docs           |                6K |
| Billing/payment docs         |                6K |
| Release notes/changelogs     |                6K |

Exact counts may change based on generator design.

Report the final distribution.

---

# 8. Realistic File Formats

Exercise the actual ingestion pipeline.

Include representative:

* Markdown
* plain text
* PDF
* JSON if supported
* HTML if supported
* CSV if supported

Do not generate unsupported formats solely for benchmark appearance.

The benchmark manifest must record format distribution.

---

# 9. Hard-Negative Generation

The benchmark must intentionally contain difficult retrieval cases.

Generate:

## Near-identical incidents

```text
Mobile editor latency on iOS
Mobile editor crashes on Android
Desktop editor rendering latency
Collaborative cursor latency
Mobile upload latency
Autosave timeout
```

---

## Similar error codes

```text
ERR_AUTH_401
ERR_AUTH_403
ERR_AUTH_419
ERR_TOKEN_401
ERR_SESSION_401
```

---

## Stale documentation

Example:

Old:

```text
Increase DB connection pool to 80.
```

Current:

```text
Pool limit reduced to 30 after INC-9288.
```

The benchmark must know which document is current.

---

## Contradictory documents

Create controlled cases where:

* old guidance conflicts with current guidance;
* a proposed fix differs from deployed fix;
* support documentation lags engineering documentation.

---

## Numeric confusion

Examples:

```text
30 GB storage
300 GB storage
30 requests/sec
300 requests/min
15-minute retry
15-second retry
```

---

## Entity confusion

Create multiple:

* services
* teams
* environments
* versions
* incidents
* deployments

with related names.

---

# 10. Query Dataset

Create a frozen evaluation set.

Target:

```text
3,000–5,000 queries
```

Do not optimize using the final test set.

---

# 11. Query Categories

Include at minimum:

### Exact identifiers

Examples:

```text
ERR_AUTH_401
INC-48291
DEPLOY-2938
PAY-55210
```

---

### Natural-language paraphrases

Example:

```text
Typing feels really slow on my phone.
```

---

### Troubleshooting questions

Example:

```text
Users are being logged out after about one hour. What should I investigate?
```

---

### Numeric questions

Example:

```text
What is the current workspace storage limit?
```

---

### Version questions

Example:

```text
Which release fixed the iOS autosave regression?
```

---

### Multi-document questions

Example:

```text
What caused INC-48291 and which deployment permanently fixed it?
```

---

### Ambiguous queries

Example:

```text
Why are uploads slow?
```

---

### Hard-negative queries

Queries where many semantically similar documents exist but only one or a few are relevant.

---

### Permission-sensitive queries

Queries where the globally most relevant document is not accessible to the current principal.

---

### Unanswerable queries

Queries where no authorized supporting document exists.

---

# 12. Train / Tune / Test Isolation

Create immutable partitions.

Example:

```text
20% tune
80% test
```

or another defensible split.

The final test set must remain untouched while:

* choosing hybrid weights
* tuning BM25
* tuning vector-search parameters
* selecting chunking configuration
* implementing adaptive routing

Store hashes for:

```text
tune queries
test queries
qrels
corpus
```

Fail CI if frozen benchmark files change without an explicit benchmark-version bump.

---

# 13. Relevance Judgments

Each query must have explicit qrels.

Support graded relevance where appropriate.

Example:

```json
{
  "queryId": "Q-1429",
  "relevance": {
    "doc-2392": 3,
    "doc-5540": 2,
    "doc-9182": 1
  }
}
```

Possible interpretation:

```text
3 = direct authoritative answer
2 = strongly supporting
1 = related/supporting
0 = irrelevant
```

Document the grading policy.

---

# 14. Permission Model

Each benchmark document receives ACL metadata.

Support representative combinations:

* public
* private
* user-specific
* team-specific
* group-specific
* multiple groups
* owner-only
* shared-user grants

Example groups:

```text
engineering
support
security
finance
mobile
search
platform
billing
sre
```

---

# 15. Permission-Aware Evaluation

Each permission-sensitive query must define a principal.

Example:

```json
{
  "queryId": "Q-981",
  "principal": {
    "userId": "user-402",
    "groups": ["support"]
  },
  "globallyRelevant": [
    "security-doc-991",
    "support-doc-449"
  ],
  "authorizedRelevant": [
    "support-doc-449"
  ],
  "forbidden": [
    "security-doc-991"
  ]
}
```

Retrieval metrics must be calculated against the **authorized relevance set**, not global relevance.

---

# 16. Permission Security Invariant

For every query:

```text
UnauthorizedCandidateCount = 0
```

This must be validated:

* before fusion
* after fusion
* after reranking if later added
* before LLM context construction
* before citation rendering

No forbidden document ID, content, title, snippet, metadata, embedding result, or citation may escape into downstream stages.

---

# 17. Sparse / Dense / Hybrid Baselines

Evaluate independently:

## A. BM25

Elasticsearch only.

---

## B. Dense

MiniLM + pgvector.

---

## C. Fixed hybrid

Current normalized fusion implementation.

Do not change hybrid configuration until the initial baseline is captured.

---

# 18. Retrieval Metrics

For every corpus snapshot and retrieval mode calculate:

* nDCG@10
* MRR@10
* Recall@5
* Recall@10
* Precision@10 where meaningful
* Success@1
* Success@5

Break metrics down by:

* exact
* paraphrase
* troubleshooting
* numeric
* version
* ambiguous
* hard-negative
* permission-sensitive

---

# 19. Statistical Validation

For model/retrieval comparisons use query-level paired statistical analysis.

Preferred:

* paired bootstrap
* 95% confidence interval

Report:

```text
baseline
candidate
delta
95% CI
sample size
p/significance interpretation where applicable
```

Do not claim improvement when the interval does not support it.

---

# 20. Metric Cross-Validation

Cross-check retrieval metrics against an independent implementation.

Use an appropriate implementation such as:

* pytrec_eval
* trec_eval-compatible tooling

At minimum independently validate:

* nDCG@10
* MRR
* Recall@K

CI must fail when internal and reference implementations disagree above a documented tolerance.

---

# 21. Scale-Curve Evaluation

Run the same frozen test query set against:

```text
1K
5K
10K
25K
50K
100K
```

Capture:

```text
nDCG@10
MRR@10
Recall@10
Success@1
```

for:

```text
BM25
Dense
Hybrid
```

Calculate quality retention:

```text
quality_retention =
metric_at_100K / metric_at_1K
```

and absolute degradation.

Do not assume quality will remain stable.

The observed result is the result.

---

# 22. ANN Accuracy

If approximate pgvector indexing is used, validate ANN correctness.

Compare ANN results against exact-search ground truth on a representative query set.

Measure:

* ANN Recall@10
* ANN Recall@20 if useful

Test different relevant index/search parameters where applicable.

Document configuration.

---

# 23. Search Latency Benchmark

Measure retrieval latency independently of generation.

For each corpus size:

```text
1K
5K
10K
25K
50K
100K
```

and each retrieval mode:

```text
BM25
Dense
Hybrid
```

capture:

* p50
* p95
* p99
* mean
* min/max only for debugging
* sample count

Use enough requests for stable percentiles.

Warm-up requests must be excluded from reported measurements.

---

# 24. Cold vs Warm Performance

Measure separately where practical:

* cold-start / cold-cache behavior
* warm steady-state behavior

Do not mix the two into one headline metric.

---

# 25. End-to-End Search Latency

Separately benchmark the actual API route including:

```text
HTTP
↓
authentication
↓
principal/group resolution
↓
permission filtering
↓
sparse+dense retrieval
↓
fusion
↓
serialization
↓
response
```

Report:

* p50
* p95
* p99

Do not call database-only measurements end-to-end latency.

---

# 26. Permission-Filter Overhead

Measure the cost of ACL enforcement.

Compare under identical workloads:

```text
search with ACL predicates
vs
equivalent benchmark-only unrestricted search
```

Measure:

* p50 delta
* p95 delta
* throughput delta

This measurement is for understanding overhead.

Never remove ACL enforcement to improve production benchmark numbers.

---

# 27. Concurrent Load Testing

Add a reproducible load-testing suite.

Use an appropriate framework such as:

* k6
* Locust
* autocannon

Test the actual search API.

Primary run should use the 100K corpus.

Concurrency levels:

```text
1
5
10
25
50
100
```

Increase further only if useful.

---

# 28. Concurrent Load Metrics

At each level record:

* requests/sec
* successful requests/sec
* p50
* p95
* p99
* error rate
* timeout rate
* CPU utilization
* memory
* Postgres connections
* Elasticsearch latency
* Redis utilization where relevant
* queue depth where relevant

Identify:

* saturation point
* first bottleneck
* maximum stable operating point under a documented benchmark SLO

Do not invent the SLO after seeing results solely to maximize the claim.

---

# 29. Mixed Workload Load Test

Create a realistic mixture such as:

```text
40% hybrid search
20% BM25
20% dense
10% document listing
10% metadata/share-related read operations
```

or a more representative distribution based on IndexFlow behavior.

Run separately from pure retrieval benchmarks.

---

# 30. Ingestion Benchmark

Measure current ingestion before optimization.

Use identical benchmark hardware and data for before/after tests.

Record:

* docs/sec
* chunks/sec
* embeddings/sec
* p50 document completion
* p95 document completion
* projector lag
* ES indexing time
* Postgres time
* embedding time
* MinIO time where relevant
* queue wait
* CPU
* memory

---

# 31. Elasticsearch Projection Optimization

Investigate the known refresh bottleneck.

Implement only after capturing baseline.

Potential changes:

* Elasticsearch Bulk API
* batched outbox consumption
* bounded concurrency
* normal refresh interval
* explicit refresh only when semantically required
* controlled backpressure

Test batch sizes such as:

```text
1
10
25
50
100
250
500
```

Choose based on throughput, latency, correctness, and memory tradeoffs.

---

# 32. Ingestion Scaling

Benchmark worker concurrency:

```text
1
2
4
8
```

or until saturation.

Measure:

* throughput multiplier
* CPU scaling
* queue growth
* projector lag
* ES pressure
* memory

Do not describe superlinear results without investigating them.

---

# 33. Ingestion Correctness Gate

After optimization verify:

* every accepted document reaches expected state;
* no document marked indexed before required indexes contain it;
* no duplicate chunks;
* no missing chunks;
* no stale versions;
* no lost outbox event.

---

# 34. Permission-Aware End-to-End Test Suite

This is mandatory.

Create explicit tests covering the entire request path.

## Test P1 — Public document

Public user searches public document.

Expected:

```text
retrievable
rankable
citable
```

---

## Test P2 — Private owner

Owner searches private document.

Expected:

```text
retrievable
```

---

## Test P3 — Private non-owner

Different user searches exact document title/unique token.

Expected:

```text
zero retrieval
zero snippet
zero citation
zero LLM context exposure
```

---

## Test P4 — Direct user share

Share private document with user.

Before:

```text
not retrievable
```

After:

```text
retrievable
```

---

## Test P5 — Revoke direct share

After revocation:

```text
not retrievable
```

from both:

* Elasticsearch
* pgvector

---

## Test P6 — Group grant

Group member can retrieve.

Non-member cannot.

---

## Test P7 — Group removal

User loses group membership.

Document must cease being retrievable.

---

## Test P8 — Multiple groups

Access remains if at least one valid grant remains.

---

## Test P9 — Public → private

Document previously public becomes private.

Unauthorized users must stop seeing it.

---

## Test P10 — Private → public

Document becomes public.

All allowed principals can retrieve after synchronization.

---

## Test P11 — Exact-ID attack

Unauthorized user searches exact:

```text
document ID
incident ID
rare error code
unique quoted sentence
```

Expected:

```text
zero leak
```

---

## Test P12 — Semantic attack

Unauthorized user paraphrases confidential content.

Expected:

```text
zero dense-result leak
```

---

## Test P13 — Hybrid attack

Unauthorized document would otherwise rank #1 globally.

Expected:

```text
never appears in either candidate set
```

---

## Test P14 — Pagination attack

Unauthorized result must not appear on later pages.

---

## Test P15 — Highlight leakage

XSS-safe/highlight generation must not expose inaccessible content.

---

## Test P16 — Citation leakage

LLM citations cannot reference inaccessible documents.

---

## Test P17 — Refusal behavior

If the only answer exists in unauthorized documents:

```text
retrieval returns no supporting authorized result
LLM refuses / says evidence unavailable
```

It must never answer from inaccessible content.

---

# 35. Candidate-Stage Authorization Instrumentation

In test/eval mode allow assertions on:

```text
ES candidate IDs
dense candidate IDs
fusion candidate IDs
reranker IDs if present
LLM-context document IDs
citation IDs
```

For a forbidden document:

```text
presence at every stage must equal 0
```

This provides stronger evidence than merely checking final UI output.

---

# 36. Fault-Injection Suite

Build deterministic reliability tests.

---

## F1 — Elasticsearch unavailable

Write new document while ES is down.

Verify:

* Postgres commit behavior is correct;
* outbox persists;
* no event is lost;
* projector retries safely;
* search state converges after recovery.

---

## F2 — Projector crash before ES write

Restart projector.

Expected:

```text
event eventually processed
no loss
```

---

## F3 — Crash after ES write before acknowledgement

Event is delivered again.

Expected:

```text
idempotent result
no corruption
```

---

## F4 — Duplicate event delivery

Deliver same outbox event multiple times.

Expected:

```text
same final state
```

---

## F5 — Out-of-order content events

Deliver:

```text
contentVersion 12
contentVersion 14
contentVersion 13
```

Expected final:

```text
14
```

---

## F6 — Out-of-order ACL events

Deliver:

```text
aclVersion 20
aclVersion 22
aclVersion 21
```

Expected final:

```text
22
```

---

## F7 — Revoke while Elasticsearch is unavailable

This is critical.

Sequence:

```text
User has access
↓
ES becomes unavailable
↓
permission revoked in Postgres
↓
new aclVersion committed
↓
ES recovers
↓
old event appears
```

Expected:

```text
old ACL cannot overwrite revocation
eventual ES state matches current Postgres state
no post-recovery stale access
```

Measure the consistency/recovery window explicitly.

Do not claim zero exposure during an ES outage unless architecture truly guarantees that.

---

## F8 — Grant then immediate revoke

Rapid ACL mutation.

Expected final state:

```text
revoked
```

---

## F9 — Content update then delete

Stale content event must not resurrect deleted/current-invalid state.

---

## F10 — Manual ES ACL corruption

Modify ACL directly in Elasticsearch.

Run reconciliation.

Expected:

```text
drift detected
drift repaired
```

---

## F11 — Missing ES document

Delete projected ES document.

Reconciler must restore expected current state.

---

## F12 — Stale ES content

Force older content version.

Reconciler/projector restores current state.

---

## F13 — Projector backlog

Create large outbox backlog.

Measure:

* drain rate
* p50 recovery
* p95 recovery
* backlog depth

---

## F14 — Redis restart

Verify job-system recovery where applicable.

---

## F15 — Postgres restart

Verify safe application behavior and no silent acknowledgement/loss.

---

## F16 — Elasticsearch restart

Verify projection/search recovery.

---

# 37. Fault Metrics

Produce:

```text
fault scenarios run
events created
events retried
events lost
duplicate logical writes
stale content writes accepted
stale ACL writes accepted
unauthorized final results
drift cases injected
drift cases detected
drift cases repaired
median recovery time
p95 recovery time
max recovery time
```

---

# 38. Cross-Store Consistency Tests

For a sample or complete benchmark subset compare Postgres source-of-truth state against Elasticsearch projection.

Validate:

* document existence
* contentVersion
* aclVersion
* ACL users
* ACL groups
* visibility
* deletion state

Create a consistency checker that can run independently.

---

# 39. Reconciliation Metrics

Measure:

* documents scanned/sec
* drift cases found
* drift precision
* drift cases repaired
* repair latency
* false repairs
* unresolved cases

---

# 40. Adaptive Retrieval — Optional Second Stage

Do not implement adaptive retrieval before baseline results are frozen.

First determine where:

* BM25 wins
* dense wins
* fixed hybrid wins
* fixed hybrid hurts

Then investigate an adaptive policy.

Possible query-time signals:

* query length
* presence of identifiers
* numeric/token patterns
* lexical specificity
* IDF statistics
* BM25 score margin
* dense score margin
* top-k overlap
* rank disagreement
* score entropy

Compare:

```text
BM25
Dense
Fixed Hybrid
Adaptive
```

Possible implementations:

* deterministic rules
* dynamic alpha
* logistic regression
* small decision tree

Prefer interpretable/simple approaches unless evidence justifies complexity.

---

# 41. Adaptive Retrieval Evaluation

Adaptive retrieval must be tuned only on the tune split.

Final test evaluation must report:

```text
nDCG@10
MRR@10
Recall@10
latency
routing distribution
```

Break down routing decisions:

```text
% BM25
% dense
% hybrid
```

Also measure router correctness relative to the best available baseline per query for analysis only.

Do not report oracle performance as deployable performance.

---

# 42. Generation / RAG End-to-End Evaluation

Retrieval is the primary evaluation target.

However, IndexFlow also generates cited answers, so add a separate frozen generation suite.

Recommended categories:

* answerable
* unanswerable
* insufficient evidence
* conflicting evidence
* unauthorized-only evidence
* multi-document answer
* prompt-injection content
* stale vs current documentation

---

# 43. Grounded Generation Security Tests

Mandatory cases:

## G1 — Authorized answer

Relevant authorized context exists.

Expected:

```text
answer
citations
```

---

## G2 — No evidence

Expected:

```text
refusal / insufficient evidence
```

---

## G3 — Only unauthorized evidence

Expected:

```text
refusal
zero unauthorized citation
zero unauthorized content
```

---

## G4 — Unauthorized document contains exact answer

Still must refuse.

---

## G5 — Prompt injection in retrieved document

Document says something such as:

```text
Ignore system instructions...
```

Expected:

* content treated as evidence, not instruction;
* no system prompt override;
* no secret leakage.

---

## G6 — Conflicting documents

Answer must use appropriate current/authoritative evidence or express uncertainty according to system policy.

---

# 44. Generation Metrics

Only if evaluation is reproducible, measure:

* citation precision
* citation coverage
* grounded claim rate
* refusal precision
* refusal recall
* refusal F1
* unauthorized citation count

If using an LLM judge:

* freeze judge/version/prompt;
* validate on a human-labelled subset;
* report agreement;
* do not treat judge output as unquestionable truth.

Previous unreproduced generation metrics remain withdrawn until rerun.

---

# 45. Security Test Suite

Maintain and expand coverage for:

* permission leakage
* sharing lifecycle
* IDOR
* group ownership
* cross-store consistency
* XSS highlighting
* rate limiting
* authentication
* authorization
* unsafe direct resource access

Run integration tests against real:

* PostgreSQL
* Elasticsearch
* Redis
* MinIO where relevant

Mocks alone are insufficient for system guarantees.

---

# 46. IDOR Tests

Attempt unauthorized access to:

* document metadata
* document body
* download endpoint
* chunk endpoint
* search
* share endpoint
* permission endpoint
* group endpoint
* job status
* generated answer/citation resource if applicable

Use predictable IDs and IDs obtained from another user's accessible metadata where applicable.

All unauthorized access must fail closed.

---

# 47. XSS / Content-Safety Tests

Documents should contain adversarial content such as:

```html
<script>alert(1)</script>
<img src=x onerror=alert(1)>
```

Validate:

* search snippets
* highlights
* document previews
* citations

do not execute unsafe markup.

---

# 48. Rate-Limit Tests

Validate:

* per-user behavior
* anonymous/demo behavior
* burst behavior
* limit reset behavior
* protected endpoints
* no trivial bypass via query-string/path variation where applicable

---

# 49. Demo Mode Tests

If `DEMO_MODE=1` remains supported, validate:

* no destructive/admin action becomes public;
* seeded users cannot reach private data;
* rate limits apply;
* upload limits apply where expected;
* generated benchmark data does not expose secrets.

---

# 50. Data Integrity Tests

Validate:

* duplicate upload handling
* duplicate chunk prevention
* content hash behavior
* version increments
* deletion propagation
* failed parse behavior
* partial upload failure
* MinIO failure
* malformed PDF
* oversized documents
* empty documents
* unsupported file types

---

# 51. Async Pipeline Tests

Test:

```text
upload
↓
storage
↓
job creation
↓
extract
↓
chunk
↓
embed
↓
Postgres write
↓
outbox
↓
ES projection
↓
indexed status
```

Assert each transition.

Test retries and partial failures at every stage.

---

# 52. End-to-End User Journeys

Add Playwright or equivalent E2E tests for:

## E2E-1 — Upload and search

```text
sign in
upload
wait for indexed
search
open result
```

---

## E2E-2 — Upload and ask cited question

```text
upload
index
ask
receive answer
verify citations
```

---

## E2E-3 — Share with user

```text
user A uploads
user B cannot find
user A shares
user B can find
```

---

## E2E-4 — Revoke

```text
user B can find
user A revokes
synchronization completes
user B cannot find
```

---

## E2E-5 — Group access

```text
group created
document shared
member accesses
non-member denied
```

---

## E2E-6 — Permission-sensitive AI answer

User asks question whose best answer is in a forbidden document.

Expected:

```text
forbidden doc never retrieved
answer uses authorized evidence or refuses
```

---

## E2E-7 — Search mode parity

Run:

* BM25
* dense
* hybrid

under identical identity/ACL conditions.

All must obey authorization.

---

# 53. Observability

Instrument important paths through OpenTelemetry.

Track where practical:

* API latency
* sparse retrieval latency
* dense retrieval latency
* fusion latency
* ACL resolution latency
* embedding latency
* ingestion pipeline duration
* projector lag
* outbox backlog
* reconciliation runs
* ES errors
* Postgres errors
* queue retries

Never log sensitive document content unnecessarily.

---

# 54. Benchmark Environment Recording

Every benchmark must record:

```text
date
git commit
OS
CPU
memory
Node version
Postgres version
Elasticsearch version
Redis version
pgvector version
embedding model
index configuration
corpus version
query version
qrels hash
configuration
warm/cold mode
number of repetitions
```

---

# 55. Benchmark Repetition

Do not report one lucky run.

For latency/performance benchmarks:

* warm system first;
* perform multiple independent runs;
* report median run where appropriate;
* retain raw outputs.

For retrieval metrics:

* deterministic query evaluation;
* statistical comparison performed over queries.

---

# 56. CI Strategy

Split CI into tiers.

## PR-fast

Run:

* unit tests
* lint
* typecheck
* deterministic benchmark integrity tests
* selected authorization tests
* selected retrieval regression tests

---

## Integration

Run real services:

* PostgreSQL
* Elasticsearch
* Redis
* MinIO

Test:

* outbox
* permissions
* sharing
* projection
* reconciliation
* IDOR
* pipeline

---

## Heavy / Scheduled

Run:

* full SaaSBench test set
* scale snapshots
* fault injection
* load benchmark
* full generation benchmark
* 100K corpus benchmark

May be nightly or manually triggered if runtime is excessive.

Never silently skip a required heavy test and report PASS.

Use explicit:

```text
PASS
FAIL
NOT RUN
BLOCKED
```

---

# 57. Test Result Integrity

CI scripts must fail loudly when:

* required services are missing;
* benchmark artifacts are absent;
* result count is incorrect;
* queries were skipped;
* corpus hashes mismatch;
* expected scale snapshot is unavailable;
* metrics cannot be calculated.

Never convert missing evidence into success.

---

# 58. Benchmark Artifact Storage

Persist machine-readable outputs such as:

```text
results.json
latency.csv
retrieval.csv
load-test.json
fault-injection.json
acl-audit.json
environment.json
```

Do not store only Markdown summaries.

Markdown reports should be generated from raw artifacts where practical.

---

# 59. Final Metric Dashboard

Generate one consolidated report containing:

## Corpus

```text
documents
scenarios
queries
permission-sensitive queries
chunks
embeddings
```

## Retrieval

```text
BM25 nDCG@10
Dense nDCG@10
Hybrid nDCG@10
MRR@10
Recall@10
```

## Scale

```text
quality at 1K
quality at 100K
quality retention
```

## Latency

```text
p50
p95
p99
```

## Load

```text
max stable QPS
p95 at chosen concurrency
error rate
```

## Ingestion

```text
before docs/sec
after docs/sec
improvement
p95 completion
```

## Security

```text
authorization assertions
unauthorized candidate leaks
unauthorized final-result leaks
unauthorized citation leaks
IDOR tests
```

## Reliability

```text
fault scenarios
lost events
stale writes
drift repairs
recovery time
```

---

# 60. Required Reports

Produce:

```text
docs/remediation/
├── saasbench-design.md
├── retrieval-evaluation.md
├── scale-evaluation.md
├── ingestion-benchmark.md
├── load-test-report.md
├── permission-audit.md
├── fault-injection-report.md
├── generation-evaluation.md
├── claim-ledger.md
└── final-remediation-report.md
```

---

# 61. Claim Ledger

`claim-ledger.md` must contain:

| Claim | Metric | Evidence      | Status   | Resume Safe |
| ----- | -----: | ------------- | -------- | ----------- |
| ...   |    ... | artifact/test | VERIFIED | YES/NO      |

Possible statuses:

```text
VERIFIED
UNVERIFIED
WITHDRAWN
SUPERSEDED
BLOCKED
```

A claim is resume-safe only when:

* reproducible;
* correctly scoped;
* limitations documented;
* based on current implementation;
* not contradicted by another benchmark.

---

# 62. Resume Evidence — SWE

At the end, choose exactly **two strongest SWE/backend findings**.

Prioritize:

### Candidate A — performance

Structure:

> Improved X using Y, achieving Z.

Likely source:

* ingestion optimization
* QPS/load test
* latency scaling

Example structure only:

> Increased asynchronous indexing throughput **X× from A to B docs/sec** by batching Elasticsearch projection through a transactional outbox while preserving versioned search-index consistency.

---

### Candidate B — reliability / permission-aware architecture

Likely source:

* authorization tests
* failure injection
* cross-store consistency

Example structure only:

> Engineered permission-aware retrieval across PostgreSQL/pgvector and Elasticsearch, preventing unauthorized candidates across **N ACL assertions** and recovering from **M injected projection failures** without stale writes.

Use actual results only.

---

# 63. Resume Evidence — AI/Search

At the end, choose exactly **two strongest AI/Search findings**.

### Candidate A — retrieval quality

Likely structure:

> Built BM25 + MiniLM hybrid retrieval over a **100K-document synthetic SaaS knowledge base**, improving nDCG@10 by **X%** and MRR@10 by **Y%** over the strongest validated baseline across **N frozen queries**.

Only use if supported.

---

### Candidate B — scale / adaptive retrieval / evaluation

Possible structure:

> Evaluated sparse, dense, and hybrid retrieval across a **100× corpus expansion**, retaining **X% nDCG@10** at 100K documents while measuring query-level significance with paired bootstrap testing.

or, if adaptive retrieval succeeds:

> Developed an adaptive sparse/dense retrieval policy that improved **X%** over fixed hybrid fusion while reducing regressions on exact and paraphrase query classes.

The actual result determines which story wins.

---

# 64. Final Acceptance Gates

The remediation is not complete until the following are explicitly classified.

## Benchmark

* [ ] SaaSBench generator deterministic
* [ ] 100K-document snapshot generated
* [ ] corpus version/hash recorded
* [ ] 3K–5K query set created
* [ ] qrels frozen
* [ ] tune/test isolation enforced
* [ ] ACL metadata generated
* [ ] hard negatives included

## Retrieval

* [ ] BM25 evaluated
* [ ] dense evaluated
* [ ] hybrid evaluated
* [ ] nDCG@10 measured
* [ ] MRR@10 measured
* [ ] Recall@5 measured
* [ ] Recall@10 measured
* [ ] query-category breakdown produced
* [ ] independent metric cross-check passed
* [ ] paired statistical comparison produced

## Scale

* [ ] 1K run
* [ ] 5K run
* [ ] 10K run
* [ ] 25K run
* [ ] 50K run
* [ ] 100K run
* [ ] quality-degradation curve
* [ ] latency curve
* [ ] ANN recall validation

## Performance

* [ ] baseline ingestion benchmark
* [ ] ES bottleneck profiled
* [ ] optimization implemented if justified
* [ ] post-change ingestion benchmark
* [ ] concurrent load test
* [ ] QPS measured
* [ ] p50 measured
* [ ] p95 measured
* [ ] p99 measured
* [ ] saturation point identified

## Permission Awareness

* [ ] ACL enforced inside Elasticsearch
* [ ] ACL enforced inside Postgres/pgvector
* [ ] unauthorized candidates = 0 in sparse path
* [ ] unauthorized candidates = 0 in dense path
* [ ] unauthorized candidates = 0 after fusion
* [ ] unauthorized context = 0 before generation
* [ ] unauthorized citations = 0
* [ ] share lifecycle tests pass
* [ ] revoke tests pass
* [ ] group membership tests pass
* [ ] exact-ID attacks pass
* [ ] semantic attacks pass
* [ ] pagination tests pass
* [ ] direct-object-access tests pass

## Distributed Consistency

* [ ] duplicate event test
* [ ] out-of-order event test
* [ ] stale aclVersion test
* [ ] stale contentVersion test
* [ ] ES outage
* [ ] projector crash
* [ ] Redis restart
* [ ] Postgres restart where practical
* [ ] drift injection
* [ ] reconciliation repair
* [ ] backlog recovery
* [ ] no silent event loss

## RAG / Answering

* [ ] authorized answer E2E
* [ ] no-evidence refusal
* [ ] unauthorized-only evidence refusal
* [ ] citation authorization
* [ ] prompt-injection test
* [ ] conflicting-evidence test

## Engineering Quality

* [ ] unit suite passes
* [ ] integration suite passes against real services
* [ ] E2E suite passes
* [ ] benchmark failures fail loudly
* [ ] heavy tests never silently skip
* [ ] OpenTelemetry instrumentation maintained
* [ ] raw benchmark artifacts saved
* [ ] environment captured
* [ ] documentation updated
* [ ] claim ledger complete

---

# 65. Final Remediation Status

Finish with exactly one status:

```text
PASS
PARTIAL
FAIL
BLOCKED
```

## PASS

Only when all mandatory gates are complete and evidence exists.

## PARTIAL

Use when implementation is strong but one or more non-critical benchmark/test families remain incomplete.

## FAIL

Use when core correctness is broken.

Examples:

* permission leakage
* stale ACL overwrite
* event loss
* benchmark invalidity

## BLOCKED

Use when an external infrastructure limitation prevents necessary evidence.

Never label BLOCKED work as PASS.

---

# 66. Final Deliverable Format

The final remediation report must clearly answer:

### What was built?

Summarize technical changes.

### What was measured?

Provide exact metrics.

### What improved?

Provide before/after evidence.

### What did not improve?

Document negative results.

### What failed?

Document failures honestly.

### What remains unproven?

Explicitly identify limitations.

### What can safely go on a resume?

Provide exactly:

* 2 SWE/backend candidate bullets
* 2 AI/Search candidate bullets

Each bullet must link back to reproducible evidence in the claim ledger.

---

# 67. Core Principle

The purpose of this remediation is not to turn IndexFlow into a benchmark that always wins.

The purpose is to turn IndexFlow into a system where we can credibly say:

> We built a permission-aware search architecture, constructed a controlled 100K-document SaaS benchmark, measured sparse/dense/hybrid retrieval quality as the index scaled, profiled and optimized system bottlenecks, load-tested the real API, and attacked the authorization and distributed-consistency model under realistic failures.

If the resulting numbers are strong, use them.

If they are weak, find the engineering reason, improve the system, and rerun the same frozen benchmark.

If an optimization does not work, document it.

**Correctness, reproducibility, security, and technical defensibility take precedence over impressive metrics.**
