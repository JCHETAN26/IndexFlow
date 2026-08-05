# IndexFlow — evaluation results

**Run dates: 2026-07-26 for the security, generation and latency evals; 2026-08-05 for retrieval
(§1) and the scale runs (§1b).** Every eval below was executed against live services and captured
verbatim — nothing here is retyped or rounded by hand. Where a number superseded an earlier one,
the earlier value is struck through with its reason rather than deleted.

> **This file is the single source of truth for every number in this repository.**
> The README quotes this file and nothing else. If a number appears anywhere else in the repo and
> disagrees with this file, this file is right and the other place is stale.

**Environment.** §1 and §1b run on GitHub Actions `ubuntu-latest` (Postgres 16 + pgvector,
Elasticsearch 8.15.3), with run ids given per section; the 2026-07-28 capture of §1 reproduced
bit-for-bit there, so those results are not machine-specific. Everything else:
8 GB Mac (Apple silicon), Node v22.12.0. Services in local Docker:
Postgres 16 + pgvector, Elasticsearch 8.15.3 (512 MB heap), Redis 7, MinIO. Generation and judging
run on local Ollama — `llama3.2:3b` (generator), `qwen2.5:7b` (relevance/citation judge),
`bespoke-minicheck` (per-claim faithfulness). No API keys, no network calls.

**To reproduce:** bring the stack up with `pnpm db:up`, ensure Ollama has the three models pulled,
then run the commands below in order. The generation eval takes ~30 minutes on this machine.

## Summary

| Eval | Command | Headline | Gate |
|---|---|---|---|
| Retrieval quality (held-out, 17 docs) | `pnpm --filter @indexflow/web eval` | semantic **MRR 0.97**; hybrid+rerank 0.93; hybrid 0.89; keyword 0.75 — **benchmark saturated, see §1** | PASS |
| Retrieval at scale (BEIR SciFact) | `BEIR_SUBSET=scifact … eval:scale` | hybrid **nDCG@10 0.707** over 5,183 docs, above published BM25 0.665 | n/a |
| Retrieval at scale (BEIR NFCorpus) | `BEIR_SUBSET=nfcorpus … eval:scale` | hybrid **nDCG@10 0.332** over 3,633 docs; depth, not ranking, limits recall | n/a |
| Metric cross-check | `python3 eval/crosscheck.py` | agrees with `pytrec_eval` to machine epsilon, no correction | PASS |
| Permission leaks | `pnpm --filter @indexflow/web acl:leak` | **9/9**, no leaks | PASS |
| Sharing lifecycle | `pnpm --filter @indexflow/web acl:sharing` | **8/8** | PASS |
| Direct object access | `pnpm --filter @indexflow/web acl:dao` | **13/13** | PASS |
| Cross-store consistency | `pnpm --filter @indexflow/web consistency:check` | **8/8** | PASS |
| Generation quality | `pnpm --filter @indexflow/web eval:rag` | faithfulness **98%** (human-calibrated, κ 1.00); refusal **92%** (LLM-judged) | PASS |
| Judge calibration | `pnpm --filter @indexflow/web judge:calibrate` | 40 blind human labels: **90%** agreement, κ **0.29**; citation judge lenient | n/a |
| Adversarial security | `pnpm --filter @indexflow/web eval:adversarial` | **0/30** disclosures, **0/10** injection leaks | PASS |
| Latency & scale | `pnpm --filter @indexflow/web bench:latency` | p50 flat 1k→100k chunks | n/a |

---

## 1. Retrieval quality

```
COMMAND:  pnpm --filter @indexflow/web eval
RUN:      2026-08-05 (ubuntu-latest, CI run 30964731360)
EXIT:     0
```

> **These numbers supersede the 2026-07-28 capture, and most of them went UP without the system
> improving.** The cause is a scoring fix, not a retrieval change: one held-out query has no
> relevant document, and it was contributing 0 to the numerator and 1 to the denominator of every
> ranking metric. That capped MRR, recall@k and nDCG at 33/34 = 0.9706. Unanswerable queries are
> now excluded from the denominator, which is also `trec_eval`'s convention. Every held-out metric
> below is therefore the old one multiplied by 34/33.
>
> Superseded, retained for traceability: ~~semantic MRR 0.94, hybrid 0.85, hybrid+rerank 0.90,
> keyword 0.73; R@5 97% for semantic/hybrid/+rerank~~ — denominator included an unscoreable query.

```
Retrieval eval — 64 queries over 17 docs
* Dataset 2026-07-26.2 (queries 787aeddbf260, corpus 29789f602b8a)
* Split: 30 tuning (weight chosen here) / 34 held-out (reported below)
* Scored on 33 of 34 held-out queries — 1 has no relevant document and is excluded from every
  ranking metric (measured separately below)
* Embedding: Xenova/all-MiniLM-L6-v2 (384-dim)
* Reranker: Xenova/bge-reranker-base
* Initial retrieval: keyword 17 / semantic 17 chunks (production CANDIDATE_LIMIT, clamped to corpus)
────────────────────────────────────────────────────────────────────────────────
Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5
────────────────────────────────────────────────────────────────────────────────
keyword          0.75    62%    79%    82%    29%    74%
semantic         0.97    88%   100%   100%    37%    98%
hybrid           0.89    76%    97%   100%    36%    92%
hybrid+rerank    0.93    83%    97%   100%    36%    95%
ceiling          1.00    94%   100%   100%    37%   100%
────────────────────────────────────────────────────────────────────────────────
as % of attainable ceiling:
keyword          75%    66%    79%    82%    78%    74%
semantic         97%    94%   100%   100%   100%    98%
hybrid           89%    81%    97%   100%    97%    92%
hybrid+rerank    93%    89%    97%   100%    97%    95%
────────────────────────────────────────────────────────────────────────────────
95% PAIRED bootstrap on the per-query MRR difference (held-out):
  Δ MRR semantic − keyword          +0.22 [ 0.11, 0.35]   excludes zero: yes   SIGNIFICANT
  Δ MRR hybrid+rerank − keyword     +0.18 [ 0.08, 0.28]   excludes zero: yes   SIGNIFICANT
  Δ MRR hybrid − keyword            +0.14 [ 0.07, 0.23]   excludes zero: yes   SIGNIFICANT
  Δ MRR semantic − hybrid           +0.08 [ 0.01, 0.16]   excludes zero: yes   SIGNIFICANT
  Δ MRR semantic − hybrid+rerank    +0.04 [-0.03, 0.13]   excludes zero: no    not significant
  Δ MRR hybrid+rerank − hybrid      +0.03 [-0.03, 0.10]   excludes zero: no    not significant
────────────────────────────────────────────────────────────────────────────────
by query kind (R@1 / MRR), HELD-OUT — this is what the gate scores:
            keyword        semantic       hybrid         hybrid+rerank
exact            87% / 0.97     93% / 1.00     93% / 1.00     93% / 1.00
paraphrase       42% / 0.57     83% / 0.94     61% / 0.80     75% / 0.86
────────────────────────────────────────────────────────────────────────────────
rejection — 1 unanswerable / 33 answerable held-out queries:
  keyword   unanswerable top 2.882   answerable min 0.053 / med 5.193 / max 11.338  NOT separable
  semantic  unanswerable top 0.094   answerable min 0.196 / med 0.477 / max 0.723   separable
  hybrid    not measurable — min-max normalisation puts every query's top at 1.000
────────────────────────────────────────────────────────────────────────────────
quality gate (ALL rows now scored on held-out data):
  PASS  keyword R@1 on exact:  87% (floor  50%)
  PASS  semantic R@1 on paraphrase:  83% (floor  70%)
  PASS  semantic MRR overall:  97% (floor  85%)
  PASS  hybrid R@5 overall: 100% (floor  90%)
  PASS  hybrid best on exact queries:  93% (floor  85%)
  PASS  hybrid does not collapse on paraphrase:  80% (floor  75%)
────────────────────────────────────────────────────────────────────────────────

Quality gate passed. ✓
```

**Every metric now prints its attainable ceiling.** This is not decoration. `R@5 = 100%` and
`P@3 = 37%` look like a triumph and a disaster respectively; they are the same thing — 100% of what
the labels permit. Label density caps P@3 at 37% because almost every query has one relevant
document, and caps R@1 at 94% because four have two. A score without its ceiling is unreadable in
both directions.

**This benchmark is saturated and should not be used to choose between configurations.** R@5 is at
100% of ceiling for semantic, hybrid and hybrid+rerank simultaneously, and the bootstrap interval
on hybrid R@5 is [100%, 100%] — a zero-width confidence interval. See §1b for a corpus that can
still discriminate.

### What changed, and what did not survive

**1. The significance claim was wrong, in this repository's own disfavour.**

> Superseded: ~~"intervals this wide on a set this size mean small gaps are not rankings"~~ and
> ~~"treat differences of a few points as noise and do not rank configurations by them"~~.

Marginal intervals overlap — semantic MRR 97% [92–100] against hybrid 89% [81–96] — but that does
not imply the difference is insignificant. Both strategies are scored on the *same* queries, so the
comparison is paired, and the paired interval removes the per-query variance the marginal ones
keep. The paired result is **+0.08 [0.01, 0.16], excluding zero**. Blending a weak keyword leg into
a strong semantic one **measurably** hurts retrieval on this corpus. The old framing was cautious
to the point of being wrong.

**2. "Hybrid is the best configuration for exact-match queries" did not survive the gate fix.**

> Superseded: ~~exact-query table showing hybrid 95% / 1.00 against semantic 86% / 0.94~~ — computed
> over tune + test, including the 30 queries that selected hybrid's own blend weight.

Four of six gate rows were scored on tune + test. Pointed at held-out data, exact queries are a
**three-way tie**: semantic, hybrid and hybrid+rerank all score R@1 93% / MRR 1.00. Hybrid is not
best on exact queries; it is tied, and the apparent advantage came from the queries that tuned it.
The gate row named `hybrid best on exact queries` still passes but no longer tests what its name
claims.

**3. Reranking's benefit is not statistically supported here.**

> Superseded: ~~"Reranking therefore does help hybrid (0.85 → 0.90)"~~ — stated as a result on the
> strength of a point estimate alone.

The paired interval is **+0.03 [−0.03, 0.10], including zero**. The point estimate is positive at
every configuration tested, so the reranker may well help, but 33 queries cannot establish it.
Reranking remains off by default.

**4. The eval was measuring a configuration that never shipped.**

The harness retrieved the keyword leg at every chunk in the corpus and the semantic leg at
`LIMIT 10`, while production retrieves both at `CANDIDATE_LIMIT = 30`. That asymmetry is not
neutral — `blendHybrid` min-max normalises each leg independently, and a deeper list has a lower
minimum, which compresses its top toward 1.0. Measured directly: semantic's normalised runner-up
rises from 0.565 at depth 10 to 0.659 at depth 17. The harness now mirrors production. Held-out
hybrid moved 0.88 → 0.89; the mechanism is real and the effect at this corpus size is not.

**5. `DEFAULT_HYBRID_WEIGHT` did not match the sweep.** The constant read 0.4 while the sweep had
selected 0.55, so production served a blend no published number described. Re-selected at **0.45**
on the tuning split at production depth.

**6. The metric implementations are now verified.** `recallAt`, `mrr`, `precisionAt` and `ndcgAt`
were from-scratch and untested while gating CI. They are cross-checked against `pytrec_eval` (NIST
`trec_eval`) on four synthetic rankers × six measures, agreeing to **machine epsilon with no
correction** ([CI 30963101701](https://github.com/JCHETAN26/IndexFlow/actions/runs/30963101701)), and
pinned by 20 unit tests asserting hand-derived exact values.

**Still true, and unchanged:** the selection criterion is the mean of per-kind MRR rather than
pooled MRR; the `blendHybrid` lowest-hit wart is real and immaterial here; the sweep plateau is
flat, which is itself the finding. 30 of the 64 queries were added in the IF-3 pass with minimal
lexical overlap, so this benchmark is deliberately harder than the original and tilted toward
semantic retrieval.

---

## 1b. Retrieval quality at scale (BEIR)

Everything in §1 is measured on 17 documents, where retrieval is a 17-way classification problem.
These runs use the same chunker, embeddings, Elasticsearch BM25 and blend against public corpora
with third-party relevance judgements, so the numbers can be checked against published baselines by
someone who does not trust this repository.

```
COMMAND:  BEIR_SUBSET=scifact  pnpm --filter @indexflow/web eval:scale
RUN:      2026-08-05 (CI run 30978548207) — 5,183 docs, 300 held-out queries, 815s
COMMAND:  BEIR_SUBSET=nfcorpus pnpm --filter @indexflow/web eval:scale
RUN:      2026-08-05 (CI run 30982743336) — 3,633 docs, 323 held-out queries, 623s
```

**SciFact** — 5,183 documents, 300 held-out queries, binary relevance, 1.13 relevant per query:

```
Strategy         MRR    R@1     R@5     R@10    P@3     nDCG@10
keyword        0.62    50.8%   71.3%   76.2%   23.7%   64.6%
semantic       0.61    49.4%   71.4%   79.8%   23.0%   64.8%
hybrid         0.68    56.4%   77.7%   83.1%   25.2%   70.7%
ceiling        1.00    95.5%  100.0%  100.0%   36.9%  100.0%

  Δ MRR hybrid − keyword     +0.056 [0.033, 0.081]   SIGNIFICANT
  Δ MRR hybrid − semantic    +0.071 [0.043, 0.099]   SIGNIFICANT
  Δ MRR keyword − semantic   +0.015 [-0.024, 0.052]  not significant
```

**NFCorpus** — 3,633 documents, 323 held-out queries, graded relevance, 38 relevant per query:

```
Strategy         MRR    R@1     R@6*    R@10    P@3     nDCG@10
keyword        0.50     5.7%   12.7%   14.8%   32.7%   29.9%
semantic       0.51     4.2%   12.3%   14.8%   34.2%   30.8%
hybrid         0.53     5.1%   14.4%   16.4%   38.1%   33.2%
ceiling        1.00    17.9%   50.2%   61.5%   92.9%  100.0%
   * R@6 = the k that actually reaches the generator

  Δ MRR hybrid − keyword     +0.032 [0.002, 0.062]   SIGNIFICANT
  Δ MRR hybrid − semantic    +0.023 [0.004, 0.044]   SIGNIFICANT
  Δ MRR semantic − keyword   +0.008 [-0.031, 0.046]  not significant
```

### External anchor — the pipeline reproduces published baselines

| corpus | metric | ours | published | delta |
|---|---|---|---|---|
| SciFact | BM25 nDCG@10 | **0.646** | ≈0.665 (BEIR, Thakur et al. 2021) | −0.019 |
| SciFact | all-MiniLM-L6-v2 nDCG@10 | **0.648** | ≈0.645 (sentence-transformers) | +0.003 |
| NFCorpus | BM25 nDCG@10 | **0.299** | ≈0.325 (BEIR) | −0.026 |

Chunking, indexing, embedding, scoring, metric computation and document-level deduplication
together reproduce the literature to within about 0.02. Our hybrid configuration scores **0.707 on
SciFact, above published BM25 (0.665)**, from a 22M-parameter embedding model with no reranker.

The published figures above are quoted from the BEIR literature and have **not** been independently
re-derived in this repository; only our own column is a measurement.

### "Hybrid does not beat both single strategies" was over-generalised

> Superseded: ~~"Blending a weak keyword leg into a strong semantic one costs more than it returns"~~
> as a general claim. It is true *of this corpus*, and false on both public corpora tested.

| corpus | keyword vs semantic | hybrid vs both |
|---|---|---|
| in-domain (17 docs) | semantic **+0.22**, dominant | **−0.08, significantly worse** |
| SciFact (5,183 docs) | +0.015, not significant | **+0.056 / +0.071, significant** |
| NFCorpus (3,633 docs) | +0.008, not significant | **+0.032 / +0.023, significant** |

**Hybrid is worth running when neither leg dominates, and is actively harmful when one does.** On
the in-domain corpus semantic leads keyword by 0.22 and the blend can only drag it down. On both
public corpora the legs are statistically tied and disagree usefully, so blending captures what each
misses. Two independent confirmations, both pre-registered before the runs.

### Depth, not ranking, is what limits recall

```
NFCorpus — is CANDIDATE_LIMIT=30 the binding constraint?
  keyword    R@10 14.8%   R@30 18.0%   R@100 22.8%
  semantic   R@10 14.8%   R@30 19.8%   R@100 28.0%
  hybrid     R@10 16.4%   R@30 22.8%   R@100 31.2%
  candidate pool ceiling: 24.3% at depth 30, 32.6% at depth 100
```

The pool ceiling is the share of relevant documents present in *either* leg's candidates — recall
above it is unreachable, because no reranker can promote a document that was never retrieved.
Hybrid's R@30 of 22.8% against a 24.3% pool ceiling means **ranking is capturing 94% of what is
reachable**. A reranker's maximum possible contribution at depth 30 is 1.5 percentage points. The
lever for recall on a densely-labelled corpus is `CANDIDATE_LIMIT`, not a better ranker.

### Graded relevance is worth almost nothing here

| strategy | graded nDCG@10 | binary nDCG@10 | delta |
|---|---|---|---|
| keyword | 29.9% | 29.9% | +0.03pp |
| semantic | 30.8% | 31.1% | −0.30pp |
| hybrid | 33.2% | 33.3% | −0.07pp |

NFCorpus was chosen partly because graded judgments should make nDCG carry information binary
labels cannot. Measured, they do not — grade-2 judgments are 4.7% of the total, too sparse to move
a ranking. What makes nDCG informative here is **label density, not grading**: with ~38 relevant
documents per query nDCG@10 separates the three strategies by 3.3 points, while MRR separates them
by 0.03 and cannot distinguish them at all.

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
Three 100% scores on a 20-question set mean "no failures observed at this size", not "solved" —
and the human audit below shows the citation 100% is additionally inflated by a lenient judge.

### Human judge calibration

The generation scores above are model-graded: `bespoke-minicheck` grades per-claim faithfulness,
and `qwen2.5:7b` grades relevance, citation correctness, and refusal behaviour. **40 rows have now
been blind-labelled by a human and scored.** The result splits sharply by judge:

```
COMMAND:  pnpm --filter @indexflow/web judge:calibrate
RUN:      2026-07-28 (40 of 40 rows labelled, none blank)

OVERALL (40 items)      agreement 90%   Cohen's κ 0.29   lenient 3, strict 1

faithfulness  (bespoke-minicheck, 15 items)   agreement 100%   κ 1.00
answer relevance     (qwen2.5, 11 items)      agreement  91%   κ 0.00   lenient 1
citation correctness (qwen2.5,  8 items)      agreement  75%   κ 0.00   lenient 2
refusal              (qwen2.5,  6 items)      agreement  83%   κ 0.00   strict  1
```

**Faithfulness is validated.** `bespoke-minicheck` agreed with the human on 15/15 rows including
the minority class, κ = 1.00. The 98% faithfulness figure can be quoted as human-calibrated.

**Citation correctness at 100% is not trustworthy.** `qwen2.5` passed all 8 sampled rows; the
human rejected 2, and both rejections hold up on inspection — one answer's idempotency-key
sentence carries no citation marker at all, and another places `[1]` where the causal explanation
should be. This is a lenient judge inflating a published number, and it is exactly what the audit
was built to detect. Quote citation correctness as **LLM-judged and known-lenient**, not 100%.

**Read the three κ = 0.00 figures carefully.** `qwen2.5` returned an identical verdict for every
row within each of those slices, so there is no variance to correlate and κ collapses to zero by
construction regardless of judge quality. At n = 8–11 with a single disagreement, relevance and
refusal are *uninformative* rather than damning. Citation is the exception: 8/8 passed against 2
genuine failures is substantive evidence of leniency, not an artifact.

**One disagreement runs the other way.** Row `r89` ("which CRDT algorithm?") — the model correctly
declined, the human marked it a correct refusal, and `qwen2.5` marked it a failure. The generation
run flagged the same question as "did NOT refuse". The refusal detector is wrong here, which means
**92% refusal correctness is understated**, plausibly 12/12. The audit caught error in both
directions, which is the better outcome than finding only leniency.

To reproduce: after running `pnpm --filter @indexflow/web eval:rag`, the full report is saved to
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
each judge surface: faithfulness, answer relevance, citation correctness, and refusal. Per the run
above, faithfulness is human-calibrated; the three `qwen2.5` surfaces are not, and citation
correctness in particular should carry its leniency caveat wherever it is quoted.

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

- **The in-domain benchmark (§1) is saturated and cannot rank configurations.** R@5 sits at 100%
  of its attainable ceiling for three strategies at once, and the bootstrap interval on hybrid R@5
  is [100%, 100%]. Use §1b for anything comparative.
- **The in-domain corpus is 17 single-chunk documents.** Every document is 37–54 words against a
  180-word chunk target, so "retrieval" there is a 17-way document classification problem and
  `dedupDocs` is a no-op. This is the binding constraint on every §1 number.
- **§1b is out of domain.** SciFact is scientific claim verification and NFCorpus is nutrition
  literature. They establish that the retrieval stack is competitive against public baselines —
  they say nothing about permission-aware workspace search, which is the product.
- **Generation quality is unmeasured at scale.** The 20 answerable + 12 unanswerable questions run
  against 17 documents. Nothing measures end-to-end answer quality on a realistic corpus, and that
  is what a user actually experiences. Faithfulness is human-calibrated (κ = 1.00); relevance,
  citation and refusal remain LLM-judged, with citation known to be lenient.
- **The rejection signal rests on n = 1.** One held-out query has no relevant document, and there
  are none in the tuning split, so no rejection rate is estimable and no threshold can be
  calibrated without fitting the test set. §1 reports score separation only.
- **The relevance labels have never been audited.** The LLM judges were calibrated against a blind
  human (§4); the in-domain relevance judgments themselves rest on one person's unaudited opinion
  about which document answers which query. BEIR's judgments are third-party, which is part of why
  §1b exists.
- **The permission filter's effect on ranking quality is unmeasured.** The ACL is tested for leaks
  (§2, §3, §5), never for what removing candidates does to result quality for a restricted viewer.
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
- **No reranker measurement at scale.** §1b omits `hybrid+rerank` deliberately — roughly 11k
  cross-encoder pairs would dominate the run. Its in-domain benefit is not statistically
  significant (§1), and the NFCorpus pool-ceiling analysis bounds what it could contribute at
  depth 30 to 1.5 percentage points.
- **Published BEIR baselines are quoted, not re-derived.** Only our own column in §1b is a
  measurement taken in this repository.

**Full method, hypotheses, pre-registered predictions and the experiments that changed nothing are
in [`docs/eval/WORKLOG.md`](../../../docs/eval/WORKLOG.md), in chronological order.**
