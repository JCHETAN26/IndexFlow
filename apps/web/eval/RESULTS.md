# IndexFlow — evaluation results

**Run date: 2026-07-26 (UTC).** Every eval below was executed exactly once, in sequence, against
live services. The output is captured verbatim — nothing here is retyped or rounded by hand.

> **This file is the single source of truth for every number in this repository.**
> The README quotes this file and nothing else. If a number appears anywhere else in the repo and
> disagrees with this file, this file is right and the other place is stale.

**Environment.** 8 GB Mac (Apple silicon), Node v22.12.0. Services in local Docker:
Postgres 16 + pgvector, Elasticsearch 8.15.3 (512 MB heap), Redis 7, MinIO. Generation and judging
run on local Ollama — `llama3.2:3b` (generator), `qwen2.5:7b` (relevance/citation judge),
`bespoke-minicheck` (per-claim faithfulness). No API keys, no network calls.

**To reproduce:** bring the stack up with `pnpm db:up`, ensure Ollama has the three models pulled,
then run the six commands below in order. The generation eval takes ~30 minutes on this machine.

## Summary

| Eval | Command | Headline | Gate |
|---|---|---|---|
| Retrieval quality | `pnpm --filter @indexflow/web eval` | hybrid **MRR 0.96**, R@1 90%, R@5 97% | PASS |
| Permission leaks | `pnpm --filter @indexflow/web acl:leak` | **9/9**, no leaks | PASS |
| Sharing lifecycle | `pnpm --filter @indexflow/web acl:sharing` | **8/8** | PASS |
| Direct object access | `pnpm --filter @indexflow/web acl:dao` | **13/13** | PASS |
| Cross-store consistency | `pnpm --filter @indexflow/web consistency:check` | **8/8** | PASS |
| Generation quality | `pnpm --filter @indexflow/web eval:rag` | faithfulness **98%**, refusal **92%** | PASS |
| Adversarial security | `pnpm --filter @indexflow/web eval:adversarial` | **0/30** disclosures, **0/10** injection leaks | PASS |
| Latency & scale | `pnpm --filter @indexflow/web bench:latency` | p50 flat 1k→100k chunks | n/a |

---

## 1. Retrieval quality

```
COMMAND:  pnpm --filter @indexflow/web eval
STARTED:  2026-07-25T23:47:37Z
FINISHED: 2026-07-25T23:47:49Z
EXIT:     0
```

```
Retrieval eval — 34 queries over 17 docs
* Chunking: semantic chunker
* Embedding: Xenova/bge-base-en-v1.5
* Reranker: Xenova/bge-reranker-base
* Initial retrieval: 10 chunks per strategy
* Reranker input: Top 10 blended chunks
────────────────────────────────────────────────────────────────────────────────
Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5
────────────────────────────────────────────────────────────────────────────────
keyword          0.89    82%    88%    94%    31%    89%
semantic         0.94    87%    97%    97%    35%    95%
hybrid           0.96    90%    97%    97%    35%    96%
hybrid+rerank    0.89    82%    88%    94%    31%    89%
────────────────────────────────────────────────────────────────────────────────
by query kind (R@1 / MRR):
            keyword        semantic       hybrid         hybrid+rerank
exact            91% / 0.97     91% / 0.97     97% / 1.00     91% / 0.97
paraphrase       74% / 0.81     82% / 0.91     82% / 0.91     74% / 0.81
────────────────────────────────────────────────────────────────────────────────
hybrid weight sweep (keyword weight → MRR), best = 0.40:
0.00:0.94   0.10:0.96   0.20:0.96   0.30:0.96   0.40:0.96*  0.50:0.94   0.60:0.94   0.70:0.94   0.80:0.93   0.90:0.89   1.00:0.89 
────────────────────────────────────────────────────────────────────────────────
Reranker Regressions (4 queries):
  Query: "queries hang when too many users connect at once"
  Expected: db-connection-pool.md
  Ranks: Hybrid #1 -> Reranked #5
  Scores: KW=2.91 / SM=0.56 / Rerank=1.00
  Analysis: Reranker preferred another document more

  Query: "retry failed webhooks"
  Expected: webhook-retries.md
  Ranks: Hybrid #1 -> Reranked #2
  Scores: KW=4.52 / SM=0.61 / Rerank=1.00
  Analysis: Reranker preferred another document more

  Query: "avoid processing the same event twice"
  Expected: webhook-retries.md
  Ranks: Hybrid #2 -> Reranked #4
  Scores: KW=2.04 / SM=0.20 / Rerank=1.00
  Analysis: Reranker preferred another document more

  Query: "memory issues and stalls"
  Expected: db-connection-pool.md
  Ranks: Hybrid #1 -> Reranked #3
  Scores: KW=2.84 / SM=0.43 / Rerank=1.00
  Analysis: Reranker preferred another document more

────────────────────────────────────────────────────────────────────────────────
quality gate:
  PASS  keyword R@1 on exact:  91% (floor  50%)
  PASS  semantic R@1 on paraphrase:  82% (floor  70%)
  PASS  hybrid R@5 overall:  97% (floor  90%)
  PASS  hybrid MRR ≥ best single:  96% (floor  92%)
────────────────────────────────────────────────────────────────────────────────

Quality gate passed. ✓
```

> **Correction — the captured header mislabels the embedding model.** The run printed
> `Embedding: Xenova/bge-base-en-v1.5`, but that was a hardcoded string in `eval/run.ts` that had
> gone stale. The model actually used is **`Xenova/all-MiniLM-L6-v2` (384-dim)** — see
> `lib/embed.ts:8-9` and the `vector(384)` column in `prisma/schema.prisma:191`. The *metrics*
> above are unaffected (the real model produced them); only the printed label was wrong. The
> label is now derived from `EMBED_MODEL`/`RERANK_MODEL` at runtime, so it cannot drift again.

**Reading this honestly.** Hybrid beats both single strategies (0.96 vs 0.94 semantic, 0.89
keyword), and the split by query kind shows why: keyword wins nothing outright, but it carries
exact-match queries (91% R@1) where the blend reaches 97% R@1 / 1.00 MRR. The weight sweep is flat
between 0.10 and 0.40 — the "best = 0.40" is not a meaningful peak over 0.10, it is the top of a
plateau.

**Reranking currently makes retrieval worse.** `hybrid+rerank` scores 0.89 MRR against plain
hybrid's 0.96 — it demotes the gold document on the 4 queries listed above. The reranker is not on
the default search path. Do not describe it as an improvement.

## 2. Permission leaks

```
COMMAND:  pnpm --filter @indexflow/web acl:leak
STARTED:  2026-07-25T23:47:49Z
FINISHED: 2026-07-25T23:48:02Z
EXIT:     0
```

```
[acl-leak] retrieval leak checks
────────────────────────────────────────────────────────────
  PASS  Alice does NOT retrieve Bob's private memo (keyword+semantic+hybrid)
  PASS  Anonymous does NOT retrieve Bob's private memo
  PASS  Anonymous does NOT retrieve the engineering-only doc
  PASS  Bob (not in group) does NOT retrieve the engineering-only doc
  PASS  Alice (group member) DOES retrieve the engineering-only doc [positive control]
  PASS  Bob DOES retrieve his own private memo [positive control]
  PASS  Keyword leg returns Bob's memo for Bob [keyword ACL admits; leg is live]
  PASS  Keyword leg excludes Bob's memo for Alice [keyword ACL blocks]

[acl-leak] generation leak check
────────────────────────────────────────────────────────────
  PASS  Alice's generated answer does NOT contain Bob's secret
      answer: "I don't have enough information in the indexed documents to answer that."
────────────────────────────────────────────────────────────
No permission leaks. ✓
```

Both retrieval legs are checked independently, and two of the nine are positive controls — they
fail if the ACL filter is so aggressive it returns nothing, which would make the negative checks
pass for the wrong reason.

## 3. Sharing lifecycle

```
COMMAND:  pnpm --filter @indexflow/web acl:sharing
STARTED:  2026-07-25T23:48:02Z
FINISHED: 2026-07-25T23:48:05Z
EXIT:     0
```

```
[sharing-check] sharing lifecycle
────────────────────────────────────────────────────────────
  PASS  private: Bob cannot see it
  PASS  private: anonymous cannot see it
  PASS  after grant to Bob: Bob CAN see it (keyword+semantic)
  PASS  after grant to Bob: anonymous still cannot see it
  PASS  revoke: grant removed
  PASS  after revoke: Bob cannot see it again
  PASS  public: anonymous CAN see it
  PASS  private again: anonymous cannot see it
────────────────────────────────────────────────────────────
Sharing changes retrieval visibility correctly. ✓
```

## 3b. Direct object access

Added after the run above, alongside the fix for the hole it covers: `GET /api/documents/[id]/file`
had no authorization at all, so any anonymous caller who knew a document UUID could download the
original file, and `DELETE` accepted ownerless documents from anyone. A follow-up audit of every
route found a third: `GET /api/jobs` had no auth and returned the 50 most recent ingestion jobs
across *all* documents, disclosing the **titles and file names of other people's private uploads**
to anonymous callers. Retrieval filters visibility inside the query, so `acl:leak` structurally
could not catch any of them.

```
COMMAND:  pnpm --filter @indexflow/web acl:dao
STARTED:  2026-07-26T03:01Z
EXIT:     0
```

```
[dao-check] read gate (lib/acl canReadDocument)
────────────────────────────────────────────────────────────
  PASS  anonymous CANNOT read a private document
  PASS  non-owner CANNOT read a private document
  PASS  owner CAN read it [positive control]
  PASS  anonymous CAN read a public document [positive control]
  PASS  after a direct grant, the grantee CAN read it
  PASS  after revoking the grant, they CANNOT again

[dao-check] live HTTP surface (anonymous, http://localhost:3000)
────────────────────────────────────────────────────────────
  PASS  GET /api/documents/<private>/file anonymously → 404 (got 404)
  PASS  DELETE /api/documents/<private> anonymously → 401 (got 401)
  PASS  POST /api/documents/upload anonymously → 401 (got 401)
  PASS  the private document survived the anonymous DELETE attempt
  PASS  GET /api/jobs anonymously → 401 (got 401)
  PASS  GET /api/jobs anonymously does NOT disclose a private document's title
  PASS  GET /api/jobs/<id> for a private document anonymously → 401 (got 401)
────────────────────────────────────────────────────────────
No direct-object-access holes. ✓
```

Separately verified by hand against a real stored file, to prove the gate blocks without breaking
the feature: the same document returns **200 with its bytes** while public, **404** once flipped
private, and **200** again when restored.

`acl:leak` (9/9) and `acl:sharing` (8/8) were re-run after these changes and produced output
identical to §2 and §3, as did the retrieval eval in §1.

## 3c. Cross-store consistency

Added with the IF-1 outbox work. Postgres is the source of truth and Elasticsearch is a
projection of it; these are the ways that projection could diverge. **Both of the first two
checks failed before the change** — they were written against the old code specifically to prove
the bugs were real, not hypothetical.

```
COMMAND:  pnpm --filter @indexflow/web consistency:check
EXIT:     0
```

```
[consistency-check] revoke racing an in-flight index
────────────────────────────────────────────────────────────────
  PASS  grantee CAN reach the document while granted [positive control]
  PASS  revoked grantee CANNOT reach the document after a racing re-index

[consistency-check] readiness when the projection has not happened
────────────────────────────────────────────────────────────────
  PASS  an unprojected document does NOT read as INDEXED (no false 'ready')
  PASS  the owed projection is durably recorded in the outbox
  PASS  draining the outbox completes the projection and marks it INDEXED

[consistency-check] reconciliation of out-of-band drift
────────────────────────────────────────────────────────────────
  PASS  drift introduced [setup]
  PASS  reconcile DETECTS the drifted document
  PASS  reconcile REPAIRS it (chunks are back in ES)
────────────────────────────────────────────────────────────────
Postgres and Elasticsearch stay consistent. ✓
```

The first check is a **security** property, not a tidiness one. `ingestDocument` used to read a
document's ACL, spend seconds embedding, then write that stale snapshot to Elasticsearch. A revoke
landing in that window updated zero ES chunks (the new ones did not exist yet) and was then
overwritten — leaving a revoked principal able to reach the document through keyword search.
Reproduced on the old code, fixed by projecting from current state after the content settles.

## 4. Generation quality

```
COMMAND:  pnpm --filter @indexflow/web eval:rag
STARTED:  2026-07-26T00:27:18Z
FINISHED: 2026-07-26T00:58:40Z
EXIT:     0
```

```
Generation eval — 20 answerable + 12 unanswerable, k=6
gen: llama3.2:3b   judge: bespoke-minicheck + qwen2.5:7b
────────────────────────────────────────────────────────
faithfulness (answerable)           98%
answer relevance (answerable)      100%
citation correctness (answerable)  100%
context recall (answerable)        100%
refusal correctness (unanswerable)  92%
────────────────────────────────────────────────────────
quality gate:
  PASS  faithfulness (answerable):  98% (floor  92%)
  PASS  citation correctness (answerable): 100% (floor  90%)
  PASS  answer relevance (answerable): 100% (floor  92%)
  PASS  refusal correctness (unanswerable):  92% (floor  85%)
  PASS  context recall (answerable): 100% (floor  90%)
────────────────────────────────────────────────────────
flagged answers:
  • [faith=0.50] A client got ERR_TIMEOUT_504 on one request and an HTTP 429 on another. How should it respond to each?
      unsupported: For the HTTP 429 Too Many Requests error, the client should wait for the specified Retry-After header value before making the next request and check if the rate limit has changed  .
  • [did NOT refuse] Which specific CRDT algorithm does the collaborative editor use to merge concurrent edits?
────────────────────────────────────────────────────────

Generation quality gate passed. ✓
```

The generator and both judges are different models, so there is no self-preference bias. The two
failures are shown above rather than summarised away: one answer invented a `Retry-After`
behaviour the source did not state, and one question that should have been refused was answered.
Three 100% scores on a 20-question set mean "no failures observed at this size", not "solved".

## 5. Adversarial security

```
COMMAND:  pnpm --filter @indexflow/web eval:adversarial
STARTED:  2026-07-26T00:58:40Z
FINISHED: 2026-07-26T00:59:29Z
EXIT:     0
```

```
[adversarial-run] Rigorous Security Benchmark (Authorization & Prompt Injection)
────────────────────────────────────────────────────────────────────────────────

Results:
  Unauthorized disclosures: 0 of 30 adversarial retrieval attempts.
  Prompt injection leaks: 0 of 10 attempts.
  False refusals on legitimate queries: 0 of 2.
  Legitimate-answer accuracy: 100%

Observability (from 12 LLM runs):
  p50 Retrieval Latency: 129 ms
  p95 Retrieval Latency: 161 ms
  p50 LLM Generation Latency: 1834 ms
  p95 LLM Generation Latency: 5470 ms
  Average input tokens: 0
  Average output tokens: 17
────────────────────────────────────────────────────────────────────────────────
All adversarial benchmarks passed. ✓
```

> **Known broken:** `Average input tokens: 0` is a telemetry defect in
> `eval/adversarial-run.ts` — input tokens are never recorded. It is not a real measurement and
> must not be quoted. Tracked as a follow-up.

This eval covers the *retrieval and generation* surfaces. It does **not** cover direct object
access (fetching a document by URL); that gap is covered separately by `acl:dao`.

## 6. Latency & scale

```
COMMAND:  BENCH_SCALES=1000,10000,50000,100000 BENCH_QUERIES=200 pnpm --filter @indexflow/web bench:latency
STARTED:  2026-07-26T00:59:29Z
FINISHED: 2026-07-26T01:00:33Z
EXIT:     0
```

```
scales: 1000, 10000, 50000, 100000 · queries/scale: 200 (+20 warmup) · dim 384 · k 10

── scale 1,000 chunks ──
  loaded: pg 20,532/s · es 930/s · hnsw build 193ms
  keyword   p50     9.4  p95    86.7  p99   140.7  mean    17.1  (ms)
  semantic  p50     2.9  p95     5.9  p99     7.5  mean     3.3  (ms)
  hybrid    p50     9.3  p95    94.7  p99   110.2  mean    16.5  (ms)

── scale 10,000 chunks ──
  loaded: pg 10,806/s · es 4,545/s · hnsw build 1502.6ms
  keyword   p50     9.1  p95    18.3  p99    49.4  mean    10.7  (ms)
  semantic  p50     2.4  p95     4.8  p99     7.3  mean     2.7  (ms)
  hybrid    p50     8.6  p95    18.5  p99    29.7  mean      10  (ms)

── scale 50,000 chunks ──
  loaded: pg 31,085/s · es 11,630/s · hnsw build 5254.9ms
  keyword   p50    10.6  p95    20.7  p99    39.3  mean    12.1  (ms)
  semantic  p50     2.6  p95     5.2  p99      11  mean     3.1  (ms)
  hybrid    p50    10.2  p95    17.3  p99    28.6  mean      11  (ms)

── scale 100,000 chunks ──
  loaded: pg 58,013/s · es 16,168/s · hnsw build 13136.2ms
  keyword   p50    10.4  p95    19.2  p99    25.3  mean      11  (ms)
  semantic  p50     2.4  p95     3.8  p99     6.6  mean     2.6  (ms)
  hybrid    p50     9.4  p95    17.3  p99    27.7  mean    10.1  (ms)
```

p50 is essentially flat from 1k to 100k chunks on every strategy — the pgvector HNSW index and the
Elasticsearch inverted index both do their job. The semantic leg is consistently the faster one
(2.4–2.9 ms p50, in-process to the database); the keyword leg (9.1–10.6 ms p50) dominates hybrid
latency (8.6–10.2 ms p50) because hybrid waits on both. The worst tail is at the *smallest* scale (p95 86.7 ms
keyword at 1k, vs 19.2 ms at 100k), which is cold-cache and host noise, not a scaling effect.

HNSW build time is the cost that does grow with scale: 193 ms at 1k → 13.1 s at 100k.

---

## What these numbers do not say

- **This is local-fixture evaluation, not production traffic.** 34 queries over 17 documents for
  retrieval; 32 questions for generation. At that size a few points is noise — treat 0.96 vs 0.94
  as "hybrid is at least as good", not as a precise ranking.
- **The latency benchmark uses synthetic data**: random 384-dim unit vectors and text drawn from a
  fixed vocabulary, in an isolated `bench_chunks` table. It measures **latency, not quality**. BM25
  latency is real (real text, real index); vector *relevance* at those scales is not measured.
- **"Index throughput" is bulk-load throughput** (batched writes), not end-to-end BullMQ ingestion
  with extraction and embedding, which is far slower.
- **The generator is a 3B model** (`llama3.2:3b`) over 6 retrieved contexts. Results would differ
  with a larger model.
- **Gate floors are calibrated just under the first real run**, so a passing gate means "has not
  regressed", not "meets an externally meaningful bar".
- **Tuning and test sets are not separated.** The hybrid weight was chosen by a sweep on the same
  34 queries the metrics are reported on, so 0.96 is a tuned-set number and mildly optimistic.
  Splitting these is a known follow-up.
- **The ACL benchmark's `Average input tokens: 0`** is a bug, not a measurement (see §5).
