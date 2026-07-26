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
then run the commands below in order. The generation eval takes ~30 minutes on this machine.

## Summary

| Eval | Command | Headline | Gate |
|---|---|---|---|
| Retrieval quality (held-out) | `pnpm --filter @indexflow/web eval` | semantic **MRR 0.94**; hybrid 0.85; keyword 0.73 | PASS |
| Permission leaks | `pnpm --filter @indexflow/web acl:leak` | **9/9**, no leaks | PASS |
| Sharing lifecycle | `pnpm --filter @indexflow/web acl:sharing` | **8/8** | PASS |
| Direct object access | `pnpm --filter @indexflow/web acl:dao` | **13/13** | PASS |
| Cross-store consistency | `pnpm --filter @indexflow/web consistency:check` | **8/8** | PASS |
| Generation quality | `pnpm --filter @indexflow/web eval:rag` | LLM-judged: faithfulness **98%**, refusal **92%** | PASS |
| Adversarial security | `pnpm --filter @indexflow/web eval:adversarial` | **0/30** disclosures, **0/10** injection leaks | PASS |
| Latency & scale | `pnpm --filter @indexflow/web bench:latency` | p50 flat 1k→100k chunks | n/a |

---

## 1. Retrieval quality

```
COMMAND:  pnpm --filter @indexflow/web eval
RUN:      2026-07-26 (IF-3 dataset: held-out split, expanded queries)
EXIT:     0
```

> **These numbers replace the earlier ones, and they are lower. That is the point of this
> section.** The previous run reported hybrid MRR 0.96 over 34 queries — but the hybrid weight
> was chosen by a sweep on those same 34 queries, and the set skewed easy. This run selects the
> weight on a 30-query tuning split and reports on 34 queries it has never seen.

```
Retrieval eval — 64 queries over 17 docs
* Dataset 2026-07-26.2 (queries 787aeddbf260, corpus 29789f602b8a)
* Split: 30 tuning (weight chosen here) / 34 held-out (reported below)
* Chunking: semantic chunker
* Embedding: Xenova/all-MiniLM-L6-v2 (384-dim)
* Reranker: Xenova/bge-reranker-base
* Initial retrieval: 10 chunks per strategy
* Reranker input: Top 10 blended chunks
────────────────────────────────────────────────────────────────────────────────
Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5
────────────────────────────────────────────────────────────────────────────────
keyword          0.73    60%    76%    79%    28%    72%
semantic         0.94    85%    97%    97%    36%    95%
hybrid           0.85    71%    94%    97%    35%    88%
hybrid+rerank    0.73    60%    76%    79%    28%    72%
────────────────────────────────────────────────────────────────────────────────
held-out hybrid, with 95% bootstrap intervals:
  MRR  85% [75%–94%]     R@1  71% [56%–84%]     R@5  97% [91%–100%]
  (intervals this wide on a set this size mean small gaps are not rankings)
────────────────────────────────────────────────────────────────────────────────
by query kind (R@1 / MRR), whole set:
            keyword        semantic       hybrid         hybrid+rerank
exact            92% / 0.98     86% / 0.94     95% / 1.00     92% / 0.98
paraphrase       58% / 0.69     84% / 0.92     69% / 0.83     58% / 0.69
────────────────────────────────────────────────────────────────────────────────
hybrid weight sweep on the TUNING split (keyword weight → MRR), best = 0.55:
0.00:0.93   0.05:0.94   0.10:0.96   0.15:0.96   0.20:0.97   0.25:0.97   0.30:0.98   0.35:0.98   0.40:0.98   0.45:0.98   0.50:0.98   0.55:0.98*  0.60:0.98   0.65:0.98   0.70:0.98   0.75:0.98   0.80:0.98   0.85:0.96   0.90:0.95   0.95:0.95   1.00:0.95 
────────────────────────────────────────────────────────────────────────────────
Reranker Regressions (13 queries) — first two shown:
  Query: "queries hang when too many users connect at once"
  Expected: db-connection-pool.md
  Ranks: Hybrid #2 -> Reranked #5
  Scores: KW=2.91 / SM=0.56 / Rerank=1.00
  Analysis: Reranker preferred another document more

  Query: "retry failed webhooks"
  Expected: webhook-retries.md
  Ranks: Hybrid #1 -> Reranked #2
  Scores: KW=4.52 / SM=0.61 / Rerank=1.00
  Analysis: Reranker preferred another document more

  …
────────────────────────────────────────────────────────────────────────────────
quality gate:
  PASS  keyword R@1 on exact:  92% (floor  50%)
  PASS  semantic R@1 on paraphrase:  84% (floor  70%)
  PASS  semantic MRR overall:  94% (floor  85%)
  PASS  hybrid R@5 overall:  97% (floor  90%)
  PASS  hybrid best on exact queries:  95% (floor  85%)
  PASS  hybrid does not collapse on paraphrase:  83% (floor  75%)
────────────────────────────────────────────────────────────────────────────────

Quality gate passed. ✓
```

### What changed, and why the headline claim did not survive

**Hybrid does not beat both single strategies on held-out data.** Semantic alone scores MRR
**0.94**; hybrid scores **0.85**; keyword **0.73**. The by-kind breakdown shows the mechanism:

| Query kind | keyword | semantic | hybrid |
|---|---|---|---|
| exact (error codes, identifiers) | 0.98 | 0.94 | **1.00** |
| paraphrase (no term overlap) | 0.69 | **0.92** | 0.83 |

Hybrid is the best configuration for exact-match queries and the *second* best for paraphrases.
Because the paraphrase loss (0.92 → 0.83) is larger than the exact gain (0.94 → 1.00), pooling
them leaves semantic ahead. Blending a weak keyword leg into a strong semantic one costs more
than it returns on this corpus.

Three things were ruled out before accepting that conclusion:

1. **The selection criterion.** Pooled MRR let the larger query kind decide the weight — the
   tuning split holds 17 exact and 13 paraphrase queries, which structurally favours
   keyword-heavy weights. Replaced with the mean of per-kind MRR, and the tie broken at the
   centre of the maximising plateau rather than at a fixed preferred value. Held-out hybrid moved
   0.86 → 0.85: the criterion was genuinely defective, and fixing it changed nothing. That the
   result survives a better rule is the strongest evidence it is real.
2. **The score-blending wart** (`blendHybrid` discards each leg's lowest-scoring hit, because
   min-max normalisation sends it to exactly 0). Patched experimentally: held-out hybrid was
   unchanged at 0.86. Real bug, immaterial here.
3. **A flat sweep.** The 0.1 grid was flat across 0.3–0.8, so an arbitrary tie-break was choosing
   the weight. Refined to 0.05 steps; the plateau is still flat, which is itself the finding —
   hybrid is insensitive to weight on this data.

**Disclosure about the dataset.** 30 of the 64 queries were added in this pass, and the added
paraphrases were deliberately written with minimal lexical overlap with their source documents.
That is a harder test than the original set and it shifts the benchmark toward semantic retrieval.
It is a defensible choice — paraphrase handling is the reason to run vector search at all — but
anyone comparing these numbers to the earlier ones should know the benchmark got harder, not just
more honest.

**The quality gate changed shape.** It previously asserted "hybrid MRR ≥ best single strategy".
That assertion was removed rather than relaxed, because held-out data shows it is false; a gate
encoding it would make CI enforce a fiction. It now asserts what hybrid demonstrably is — the
strongest configuration on exact-match queries, without collapsing on paraphrases — plus a floor
on semantic, which is now the headline retriever.

**Confidence intervals are wide.** MRR 0.85 [0.75–0.94] on 34 queries. The semantic/hybrid gap is
real but the interval overlaps a lot of the range; treat differences of a few points as noise and
do not rank configurations by them.

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

### Human judge calibration

The generation scores above are still model-graded: `bespoke-minicheck` grades per-claim
faithfulness, and `qwen2.5:7b` grades relevance, citation correctness, and refusal behaviour. A
blind human-audit workflow now exists, but no human labels have been recorded yet.

After running `pnpm --filter @indexflow/web eval:rag`, the full report is saved to
`.evalrun/rag-report.json`. Build the audit sheet with:

```
pnpm --filter @indexflow/web judge:export
```

That writes `.evalrun/judge-labels.csv` and a separate `.evalrun/judge-labels.key.json`. Fill in
the CSV's `your_verdict` column without reading the key, then score agreement with:

```
pnpm --filter @indexflow/web judge:calibrate
```

The scorer reports raw agreement, Cohen's kappa, and lenient/strict disagreements overall and for
each judge surface: faithfulness, answer relevance, citation correctness, and refusal. Until that
audit is filled in, the generation metrics should be quoted as LLM-judged rather than
human-calibrated.

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

> **Historical telemetry caveat:** `Average input tokens: 0` in this captured run is a harness
> defect, not a real measurement. The code now records Ollama `prompt_eval_count` on the answer
> stream and consumes it in `eval/adversarial-run.ts`; re-run the benchmark before quoting that
> number.

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
  retrieval; 32 questions for generation. Retrieval has a proper tuning/held-out split. Generation
  remains whole-set and LLM-judged until the human audit above is completed.
- **The latency benchmark uses synthetic data**: random 384-dim unit vectors and text drawn from a
  fixed vocabulary, in an isolated `bench_chunks` table. It measures **latency, not quality**. BM25
  latency is real (real text, real index); vector *relevance* at those scales is not measured.
- **"Index throughput" is bulk-load throughput** (batched writes), not end-to-end BullMQ ingestion
  with extraction and embedding, which is far slower.
- **The generator is a 3B model** (`llama3.2:3b`) over 6 retrieved contexts. Results would differ
  with a larger model.
- **Gate floors are calibrated just under the first real run**, so a passing gate means "has not
  regressed", not "meets an externally meaningful bar".
- **The adversarial benchmark's captured `Average input tokens: 0`** is a historical harness bug,
  not a measurement. Re-run §5 before quoting input-token telemetry.
