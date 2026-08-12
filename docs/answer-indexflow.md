# IndexFlow — technical answers, and what is safe to claim

Written as interview/résumé context. Every number here was produced by a run in this repository and
is traceable to a CI run id in [`eval/RESULTS.md`](../apps/web/eval/RESULTS.md) and
[`eval/WORKLOG.md`](eval/WORKLOG.md).

**Read [§5](#5-numbers-you-must-not-use) before writing a bullet.** Several figures that were
previously published in this repo turned out to be artifacts and have been withdrawn. If any of
them are already on your CV, they need to come off.

---

## 1. Hybrid search mechanics

### What it does

Two independent retrieval legs run in parallel, and their results are merged by a **weighted linear
combination over min-max normalised scores** — not Reciprocal Rank Fusion.

```
score(chunk) = w · norm(BM25) + (1 − w) · norm(cosine)        w = 0.45
```

`lib/hybrid.ts`. Mechanically:

1. Each leg's scores are min-max normalised to [0,1] **within that leg's own result list**. BM25 is
   unbounded and cosine is not, so raw scores cannot be added.
2. The output is the **union** of both candidate sets, keyed by chunk id. A chunk found by only one
   leg contributes 0 for the other component.
3. Items scoring 0 overall are dropped, so `w=1` behaves exactly like keyword-only and `w=0` like
   semantic-only. The endpoints stay honest.

**The two legs are correlated by chunk id, and that is load-bearing.** Chunk UUIDs are generated in
application code *before* either write, so the same id keys the Postgres row and the Elasticsearch
document. Without a shared id there is nothing to blend on — you would be merging two lists that
cannot be matched to each other.

### Weight selection

Swept 0.00–1.00 in 0.05 steps **on a tuning split only**, then reported on a held-out split that
never influenced the choice. The selection criterion is the **mean of per-kind MRR** (exact-match
queries and paraphrase queries weighted equally) rather than pooled MRR, because the tuning split
is 17 exact / 13 paraphrase and pooling lets the larger kind decide the weight.

The plateau is wide and flat — 0.20–0.70 all score 0.98 on the tuning split — so 0.45 is a
**plateau centre, not a sharp optimum**. Say that out loud in an interview; it is the honest read
and it is more impressive than pretending you found a peak.

### Re-ranking

A cross-encoder (`Xenova/bge-reranker-base`) over the top `2k` blended candidates, which *replaces*
the blended ordering rather than adjusting it. **Off by default, and the measured benefit is not
statistically significant**: +0.03 MRR, 95% paired bootstrap interval [−0.03, 0.10], n=33.

### Why not RRF — the honest answer

RRF fuses on **ranks**; this fuses on **normalised scores**. That difference has a measurable
consequence I ran into:

> Min-max is scale-free but not *shape*-free. A deeper candidate list has a lower minimum, so
> normalisation compresses that leg's top toward 1.0. Measured: the semantic leg's normalised
> **second**-place score rises from 0.565 at depth 10 to 0.659 at depth 17 — the leg votes less
> decisively purely because it retrieved more.

**RRF would be immune to that**, since ranks do not move when you extend the list. I measured that
the effect exists; I did **not** implement RRF as a comparison, so I cannot tell you which performs
better here. If an interviewer asks "why not RRF?", that is the answer: a deliberate trade — scores
retain magnitude information that ranks discard, at the cost of sensitivity to list depth — and an
acknowledged untested alternative.

There is also a known wart, pinned by a unit test rather than hidden: **the lowest-scoring hit in
each list normalises to exactly 0**, making "retrieved last" indistinguishable from "not retrieved."
Patched experimentally; held-out results were unchanged.

### The finding worth leading with

Whether hybrid helps **depends on whether one leg dominates** — measured on three corpora with a
paired bootstrap:

| corpus | keyword vs semantic | hybrid vs both single strategies |
|---|---|---|
| in-domain (17 docs) | semantic **+0.22**, dominant | **−0.08, significantly worse** |
| BEIR SciFact (5,183 docs) | +0.015, not significant | **+0.056 / +0.071, significant** |
| BEIR NFCorpus (3,633 docs) | +0.008, not significant | **+0.032 / +0.023, significant** |

**Hybrid is worth running when neither leg dominates and is actively harmful when one does.** On a
tiny corpus a weak keyword leg gets averaged into a near-perfect semantic one, which can only drag
it down. This was pre-registered before the runs that tested it, and confirmed twice independently.

---

## 2. Authorization filtering

### Both legs pre-filter, independently, before ranking

**Keyword leg** — an Elasticsearch `terms` filter on a denormalised `acl` field, inside the
`bool.filter` clause (`lib/es.ts`). Index-side: restricted chunks never reach the BM25 ranker.

**Semantic leg** — a SQL predicate in the `WHERE` clause, evaluated before
`ORDER BY embedding <=> $vec LIMIT k` (`lib/retrieve.ts`):

```sql
WHERE dc.embedding IS NOT NULL
  AND ( d.is_public
        OR d.owner_id = $viewer
        OR EXISTS (SELECT 1 FROM document_grants g WHERE g.document_id = d.id AND g.user_id = $viewer)
        OR EXISTS (SELECT 1 FROM document_grants g
                   JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = $viewer
                   WHERE g.document_id = d.id) )
ORDER BY dc.embedding <=> $vec LIMIT $k
```

A viewer resolves to principals — `public`, `user:<id>`, `group:<id>` — and a document is visible
when the two sets intersect. **The two mechanisms are independent and must agree**, so neither leg
can return what the other would hide. Generation only ever sees chunks that survived the filter, so
a restricted document cannot leak into an answer even indirectly.

The design choice worth articulating: the shared retriever takes `viewer` as a **required
argument**, not an optional one. A future call site cannot forget it — that is a type-level
property, not a convention.

### The caveat you should raise before an interviewer does

**"Pre-filter in SQL" does not guarantee pre-filter at the storage layer.** With an HNSW index,
Postgres traverses the ANN graph and applies the predicate to what the traversal returns. A
selective ACL can therefore under-return — fewer than `LIMIT` rows, or true neighbours the
traversal never visited. This is a well-known pgvector behaviour, not a bug in this code.

**I did not measure it.** All three eval harnesses force exact KNN
(`SET LOCAL enable_indexscan = off`), so every published quality number sidesteps the interaction,
and the 100k scale run used HNSW with no ACL filter at all.

Raising this yourself is far stronger than being caught by it. The framing: *"the filter is
correct — proven by a leak test with positive controls — but I have not measured what ACL
selectivity does to ANN recall, and that is the next thing I'd instrument."*

### How the enforcement is proven

`acl:leak` drives the **real** retrieval and answer code, not a reimplementation, and **now gates
CI**. Eight retrieval-leg assertions, including the adversarial case where the restricted document
is the single most relevant match, plus **positive controls** — the owner and a granted group
member *do* retrieve it. Positive controls are what separate a real security test from one that
would pass if retrieval were simply broken.

Also gating: a 23-test cross-store consistency and security suite, a direct-object-access check,
sharing-lifecycle checks, and a Playwright end-to-end suite covering a guest principal.

---

## 3. Benchmarking and latency

### Setup

| | |
|---|---|
| Host | GitHub Actions `ubuntu-latest`, **4 logical CPUs** |
| Services | Postgres 16 + pgvector, Elasticsearch 8.15.3 (1 GB heap) — service containers on the same host, **so no real network hop** |
| Method | 150 queries per scale after 20 warmup, **3 independent repeats**, fresh query per measurement, strategy order shuffled per trial |
| Data | **Synthetic** random 384-dim unit vectors + fixed-vocabulary text |

### Corrected latency

| scale (chunks) | keyword p50 | semantic p50 | hybrid p50 | ANN recall@10 |
|---|---|---|---|---|
| 1,000 | 5.7 ms | 1.5 ms | 5.9 ms | 100% |
| 10,000 | 5.8 ms | 1.5 ms | 5.9 ms | 100% |
| 50,000 | 6.9 ms | 1.3 ms | 6.9 ms | 100% |

HNSW build: 37.7 ms @1k · 587 ms @10k · 4.6 s @50k · **125 s @196k**.

Readings that hold up:

- **The Elasticsearch hop is the entire hybrid latency budget** — 5.7–6.9 ms against in-process
  pgvector's 1.3–1.5 ms. Hybrid ≈ `max(keyword, semantic) + blend`.
- **Semantic latency is flat, and slightly decreases** across a 50× corpus. HNSW is sublinear.
- **Speed is not bought with recall** — ANN recall@10 is 100%, confirmed separately on **real**
  embeddings over 195,980 chunks.
- **Re-indexing, not querying, is what scale makes expensive.** HNSW build grows superlinearly.

### Scale: two different tests, neither is "100× latency"

| | range | vectors | measured |
|---|---|---|---|
| Latency bench | 1k → 50k chunks (50×) | synthetic | **latency only** |
| Phase 9a quality curve | 500 → 100,000 **documents** (200×) | **195,980 real MiniLM chunks** | **quality only** |

The 100k run embedded 195,980 chunks across **12 parallel CI jobs**, shipping vectors between jobs
as 301 MB of raw float32 (≈3 GB as JSON), with every shard stamping a dataset hash the consumer
verifies before reassembly.

**There is no measurement of query latency at 196k real embeddings.** The two tests never meet.

### Quality vs corpus size — the result worth leading with

```
docs      chunks     MRR    R@6      nDCG@10    vs 500
500       1,085      0.68   72.3%    68.5%      +0.0pp
5,000     11,155     0.68   79.1%    70.9%      +2.3pp
25,000    49,999     0.63   73.9%    66.2%      −2.3pp
100,000   195,980    0.59   69.2%    61.7%      −6.8pp

Δ MRR (500 − 100,000) = +0.088 [0.025, 0.147]   excludes zero
```

A 200× corpus costs **6.8 nDCG points**, and the degradation is statistically real. The
decomposition is the interesting part: **the dense leg degrades three times faster than BM25**
(−16.2 vs −4.2 points) and the two **cross over** — semantic leads by 6.2 points at 500 documents
and trails by 5.8 at 100,000.

### Ingestion throughput

| | |
|---|---|
| Throughput | **4.5 documents/s** on 4 cores (≈1 doc/s/core) |
| Scaling | 1.00× / 2.00× / **4.02×** / 4.49× at concurrency 1 / 2 / 4 / 8 — linear to core count, then flat |
| Bottleneck | **Elasticsearch refresh: 952 ms of 1064 ms (89.5%)**. Embedding is 10% |

The bottleneck is two forced index refreshes per document against Elasticsearch's default 1-second
`refresh_interval`. That is not a bug — it buys the documented guarantee that a document is
searchable the moment the worker reports done. **The measurement puts a price on that guarantee.**

Combining with the HNSW numbers: for a 196k-chunk corpus, **rebuilding the vector index takes ~2
minutes; re-ingesting from source takes ~4.2 hours.** An ACL change triggers projection (cheap); an
embedding-model change triggers re-ingestion (hours).

---

## 4. Numbers you can use, and the caveat each one needs

| Claim | Required caveat |
|---|---|
| Hybrid nDCG@10 **0.707** on BEIR SciFact, above published BM25 (0.665) | 5,183 docs, 300 held-out queries. Published baseline is **quoted from literature, not re-derived** |
| BM25 reproduces published BEIR to within **0.02 nDCG** (0.646 vs ≈0.665; NFCorpus 0.299 vs ≈0.325) | Same — the anchor is only as good as the citation |
| Metric implementations agree with NIST `trec_eval` to **machine epsilon**, no correction | Via `pytrec_eval`, four synthetic rankers × six measures |
| Hybrid significantly beats both single strategies on two public corpora | **Only where the legs are comparable.** State the corpus |
| Quality degrades **6.8 nDCG points across a 200× corpus**, interval excludes zero | Out-of-domain corpora; one run per tier |
| Retrieval p50: semantic **1.3–1.5 ms**, hybrid **5.9–6.9 ms**, flat 1k→50k | Synthetic vectors, single-threaded, no load test, co-located services |
| ANN recall@10 **100%** at 195,980 real embeddings | Sampled at 50 queries, k=10 only |
| Ingestion **4.5 docs/s**, 90% of it Elasticsearch refresh | One 4-core runner, ~450-word documents |
| **Zero permission leaks**, now gating CI, with positive controls | Generation-layer assertion skips without Ollama |
| Found and fixed an OOM in `embed()` that **also affected the production ingest path** | Real: batching all texts asked for ~4.5 GB |

### Suggested bullets

Defensible as written:

- *Built a permission-aware hybrid search system (Elasticsearch BM25 + pgvector HNSW) whose ACL is enforced independently on both retrieval legs and gated in CI by a leak test with positive controls — zero leaks across 8 adversarial retrieval assertions.*
- *Benchmarked retrieval against BEIR SciFact and NFCorpus; the pipeline reproduces published BM25 baselines to within 0.02 nDCG@10, and the hybrid configuration scores 0.707 on SciFact against a published BM25 baseline of 0.665.*
- *Measured retrieval quality across a 200× corpus growth to 100,000 documents (195,980 embeddings, generated across 12 parallel CI jobs), showing a statistically significant 6.8-point nDCG@10 degradation and a crossover where BM25 overtakes dense retrieval above ~5,000 documents.*
- *Verified the evaluation harness itself against NIST `trec_eval`, achieving machine-epsilon agreement, after finding that four of six CI quality gates were scored on data that had tuned the model.*
- *Profiled end-to-end ingestion and found 90% of latency was Elasticsearch refresh rather than embedding, correcting a published throughput figure that overstated real ingestion by three orders of magnitude.*

The strongest interview story is not any single number — it is **"I audited my own benchmark and
found four of six gates were leaking tuning data, a latency table that was physically impossible,
and an injection-leak count that was a hardcoded string."** That reads as engineering maturity in a
way a good MRR never will.

---

## 5. Numbers you must NOT use

These were published in this repository and are **withdrawn**. If any are on your CV, remove them.

| Withdrawn | Why |
|---|---|
| ~~"sub-11 ms p50", hybrid 8.6–10.2 ms~~ | **Artifact.** Strategies ran in fixed order on the same query, so hybrid inherited warm caches and reported a p50 *below* its own slower leg — impossible |
| ~~semantic MRR 0.94 / hybrid 0.85~~, ~~hybrid MRR 0.96~~ | Denominator included an unscoreable query; the 0.96 was additionally tuned on the set it was scored on |
| ~~"R@5 = 97%"~~ as an achievement | It was **100% of attainable** — the benchmark was saturated, with a zero-width confidence interval |
| ~~"hybrid does not beat both single strategies"~~ as a general claim | True of 17 documents, **false on both public corpora** |
| ~~"hybrid is the best configuration for exact-match queries"~~ | Computed on data including the queries that tuned it. On held-out data it is a **three-way tie** |
| ~~"reranking helps (0.85 → 0.90)"~~ | +0.03 [−0.03, 0.10] — **not significant** |
| ~~"0/10 prompt-injection leaks"~~ | Was a **hardcoded string**, not a measurement. Now counted, but not yet re-run |
| ~~"100k vector latency"~~ | The corrected latency run stops at 50k. Never measured at 100k |
| ~~ingestion throughput from the bulk-load figure~~ | That is batched bulk loading, ~1000× faster than any real upload |

### Not yet measured — do not imply otherwise

- **Answer quality at scale.** Generation is 32 questions over 17 documents. The product is RAG; a user experiences the *answer*, and that is unmeasured on a realistic corpus.
- **The relevance labels are unaudited.** Tooling exists (`labels:export`); no human has labelled the sheet. Every in-domain number rests on one person's unchecked judgment.
- **ACL cost to ranking quality**, per §2.
- **Concurrent load.** All latency is single-threaded sequential.
- **Generation metrics** (faithfulness 98%, refusal 92%) come from a 2026-07-26 run not reproduced since `embed()` batching changed underneath them.
- **In-domain performance at scale.** Everything above 17 documents is scientific abstracts, not workspace documents.

The full list is [`docs/eval/FINDINGS.md`](eval/FINDINGS.md) § "What I could not verify" — 14 items.
Reading it before an interview is the best preparation available, because it is the list of
questions a sharp interviewer would find on their own.
