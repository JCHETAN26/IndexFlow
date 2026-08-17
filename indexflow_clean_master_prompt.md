# IndexFlow — Retrieval Quality & RAG Hardening

You are working in the IndexFlow repository.

Your goal is to improve the **real production retrieval and RAG system** against the already-valid, frozen SaaSBench benchmark.

The product-quality aspiration is:

- MRR@10 > 0.80
- nDCG@10 > 0.80
- strong Success@1
- strong quality as the corpus scales toward 100K documents
- zero unauthorized retrievals
- practical end-to-end search latency

These are **aspirations, not benchmark acceptance thresholds**.

Do **not** modify the benchmark, qrels, held-out queries, structural gates, or test split to reach them.

If the system does not honestly reach these numbers, report the actual result and explain the bottleneck.

## Current trusted state

Frozen SaaSBench:
- Generator version: `2.0.0`
- 150 core scenarios
- 30 anchors
- exactly 5 scenarios per anchor
- corpus hash: `361c493cc643`
- queries hash: `234bb5777c46`

`ANCHOR_MULTIPLICITY = 5` is frozen.

All structural validity gates pass.

Two previous benchmark constructions are invalid and must never be used as baselines:
1. collided anchors → under-specified / artificially difficult
2. unique anchors → entity leakage / artificially trivial

Keep both marked `BENCHMARK_INVALID`.

## Current valid shipping baseline

Current shipping hybrid:
- nDCG@10 = `0.297`
- MRR@10 = `0.623`
- Success@1 = `45.5%`

Candidate diagnostics:

### Oracle @30
- nDCG@10 = `0.693`
- MRR@10 = `0.996`
- Success@1 = `99.6%`

### Oracle @100
- nDCG@10 = `0.927`
- MRR@10 = `1.000`
- Success@1 = `100%`

Candidate Recall@100:
- keyword ≈ `83.8%`
- semantic ≈ `68.0%`
- union ≈ `84.8%`

Interpretation:

> The main bottleneck is ranking, not first-stage retrieval.

Do not start by changing embeddings or chunking.

## Important completed findings

### Tail-drop bug
The min-max fusion tail-drop bug was real and has been fixed in production.

Measured result:
- Δ nDCG@10 = `0.000`
- 95% CI = `[0.000, 0.000]`
- n = `894`

Keep the correctness fix, but do not claim a ranking improvement.

### Chunk multiplicity
Chunk duplication is not currently a meaningful candidate-capacity problem.

At depth 100:
- keyword ≈ 95.7 unique docs / 100 chunks
- semantic ≈ 93.0 unique docs / 100 chunks

Do not redesign chunking based on this.

### Document aggregation
Tune-split experiment:

| Variant | nDCG@10 | MRR@10 | Success@1 | Recall@10 |
|---|---:|---:|---:|---:|
| Current | 0.294 | 0.623 | 46.3% | 27.2% |
| Per-leg best chunk | 0.299 | 0.623 | 46.3% | 27.6% |
| Best + capped support | 0.333 | 0.599 | 42.7% | 31.4% |

The capped-support variant improves breadth but hurts first-result quality.

Do not use it for primary search ranking. Preserve it as a possible later RAG-context experiment.

# Phase 1 — Finish and freeze the diagnostic state

Before changing ranking behavior:

1. Update the decision report.
2. Update the claim ledger.
3. Ensure `frozen.json` contains the corrected benchmark hashes.
4. Commit all diagnostic JSON artifacts.
5. Mark both previous benchmark constructions as `BENCHMARK_INVALID`.
6. Add/run dense:
   - FULL
   - ANCHOR-ONLY
   - ANCHOR-MASKED
7. Preserve the current shipping baseline exactly.

Do not modify benchmark data based on these diagnostics.

# Phase 2 — Candidate union + cross-encoder reranking

IndexFlow already has `Xenova/bge-reranker-base`.

Use it at the correct stage.

Target path:

```text
authorized BM25 candidates
        +
authorized dense candidates
        ↓
deduplicated union
        ↓
BGE cross-encoder
        ↓
document ranking
        ↓
top 10
```

The reranker must see the candidate union before weak hybrid fusion can discard useful candidates.

## Depth sweep

Run on the tune split only.

Test per-leg retrieval depths:
- 30
- 50
- 75
- 100

For each configuration:

```text
BM25 top N
+
Dense top N
→ deduplicated union
→ BGE reranker
→ top 10
```

Measure:
- MRR@10
- nDCG@10
- Success@1
- Recall@5
- Recall@10
- union candidate count
- candidates reranked/query
- reranker p50/p95 latency
- total retrieval p50/p95 latency

Also record the oracle ceiling at every depth.

Choose the smallest depth whose retrieval quality is statistically indistinguishable from the best result while offering the better latency tradeoff.

Do not assume depth 100 is automatically optimal.

Use paired-bootstrap confidence intervals for comparisons.

# Phase 3 — Ranking cascade only if necessary

If reranking the full candidate union is too expensive, test:

```text
BM25 top 100
+
Dense top 100
        ↓
union
        ↓
RRF / cheap rank-based pruning
        ↓
top M
        ↓
BGE reranker
        ↓
top 10
```

Test pruning depths such as:
- 40
- 50
- 60
- 75

For every pruning depth measure:
- oracle nDCG before pruning
- oracle nDCG after pruning
- oracle MRR after pruning
- final MRR/nDCG
- latency

Reject any pruning configuration that throws away too much relevant evidence.

# Phase 4 — Deterministic identifier fast path

Valid uncontaminated evidence shows:
- identifier keyword MRR = `1.000`
- identifier hybrid MRR = `0.648`

Evaluate a deterministic fast path for identifier-like queries.

Detect deployable patterns such as:
- `ERR_AUTH_401`
- `INC-48291`
- `TICKET-2819`
- `DEPLOY-1738`
- `v4.18.3`

Use regex/query parsing only.

Do not use SaaSBench query-class labels at inference.

Target:

```text
query
  ↓
identifier detector
  ├── identifier-like
  │      ↓
  │  exact lexical / BM25
  │
  └── natural language
         ↓
     BM25 + Dense
         ↓
       union
         ↓
   cross-encoder
```

Compare:
1. best union-reranker pipeline
2. identifier fast path + best union-reranker pipeline

Keep routing only if the tune results justify it.

# Phase 5 — Error analysis

After the strongest tune configuration is available, inspect at least 50–100 remaining failures.

Classify failures into:
- candidate missing
- candidate present but reranker fails
- exact identifier failure
- graded relevance ordering failure
- multi-document relevance failure
- hard-negative confusion
- version/current-vs-stale confusion
- permission-sensitive failure
- other

Use this taxonomy to decide what to improve next.

Do not add features before this analysis.

# Phase 6 — Improve first-stage retrieval only if justified

If error analysis or scale testing shows first-stage retrieval is limiting quality, then investigate.

## Lexical improvements

Current Elasticsearch retrieval mainly uses:
- `content`
- `title^2`

If justified, add production-realistic searchable fields derived from actual content/metadata:
- title
- content
- service
- error_code
- incident_id
- ticket_id
- deployment_id
- version
- environment
- document_type

Potential ranking signals:
- exact identifier match
- exact version match
- title phrase
- title BM25
- structured field match
- content BM25

Do not expose benchmark-only hidden metadata.

ACL enforcement must remain inside Elasticsearch before ranking.

## Embedding changes

Do not replace `all-MiniLM-L6-v2` unless dense candidate recall becomes a demonstrated bottleneck.

If justified, compare only a small number of realistic local embedding models and measure:
- Recall@30
- Recall@100
- MRR
- nDCG
- query latency
- embedding throughput
- RAM
- vector dimension
- index size

Do not select solely on quality.

# Phase 7 — Optional learned ranking

Do not add learning-to-rank for résumé keywords.

Only evaluate it if:
- candidate oracle remains high,
- cross-encoder ranking still leaves substantial measurable headroom,
- and the training protocol can avoid held-out leakage.

Potential signals:
- BM25 score/rank
- dense score/rank
- cross-encoder score
- exact identifier match
- title match
- version match
- presence in both retrieval legs
- rank agreement/disagreement
- document type

A model such as LambdaMART may be tested only if justified.

Train only on train/tune-derived data.

Never train on held-out test qrels.

Keep it only if it produces statistically defensible improvement.

# Phase 8 — Freeze the best small-corpus configuration

Once tune experiments are complete, freeze exactly one shipping configuration.

Record:
- candidate depth
- reranker depth
- identifier routing rules
- fusion/pruning strategy
- Elasticsearch configuration
- embedding model
- document aggregation mode
- reranker model
- git SHA
- benchmark version
- corpus hash
- query hash
- qrel hash
- config hash

After this point, do not change the configuration based on held-out results.

# Phase 9 — Held-out evaluation

Run the held-out test set once after configuration freeze.

Report:
- MRR@10
- nDCG@10
- Success@1
- Recall@10
- absolute delta vs shipping baseline
- relative delta
- paired-bootstrap 95% CI
- sample size

The aspiration is:
- MRR@10 > 0.80
- nDCG@10 > 0.80

But do not change the benchmark/config just because one metric misses the aspiration.

Report the real number.

# Phase 10 — External-validity regression

Rerun existing BEIR benchmarks:
- SciFact
- NFCorpus

Compare before vs after.

Do not accept large unexplained external regressions merely because SaaSBench improved.

# Phase 11 — Scale curve

After the retrieval architecture is frozen, evaluate:
- ~3.4K
- 10K
- 25K
- 50K
- 100K documents

At every rung report:
- MRR@10
- nDCG@10
- Success@1
- Recall@10
- Candidate Recall@100
- Oracle MRR@10
- Oracle nDCG@10
- actual/oracle ranking efficiency
- retrieval p50
- retrieval p95

Use the diagnostics to identify degradation:

```text
oracle drops
→ candidate-generation problem

oracle stays high but actual drops
→ ranking problem
```

Do not guess.

# Phase 12 — End-to-end load and latency

Benchmark the real HTTP path:

```text
HTTP
→ auth
→ user/group principal resolution
→ ACL filters
→ Elasticsearch
→ pgvector
→ candidate union
→ reranker
→ response
```

Test concurrency:
- 1
- 5
- 10
- 25
- 50
- 100

Report:
- QPS
- successful QPS
- p50
- p95
- p99
- errors/timeouts
- CPU
- memory
- PG connections
- ES latency
- reranker latency

Clearly distinguish microbenchmarks from full HTTP latency.

Do not call local/CI load results production traffic.

# Phase 13 — Permission regression

The security invariant is non-negotiable:

```text
authorization
→ retrieval
→ ranking
```

Never:

```text
global retrieval
→ ranking
→ ACL filtering
```

At every stage assert:

```text
unauthorized candidates = 0
```

Test at least:
- sparse candidates
- dense candidates
- candidate union
- pruning/fusion
- reranker input
- final results
- RAG context
- citations

Adversarial queries should include:
- exact confidential title
- exact confidential incident/error ID
- quoted confidential sentence
- semantic paraphrase of confidential content

Report the exact number of adversarial cases and unauthorized retrieval count.

# Phase 14 — RAG evidence selection

Only after search retrieval is frozen.

Search and RAG can use different final selection objectives while sharing the same authorized retrieval source of truth.

For search prioritize:
- MRR
- Success@1

For RAG prioritize:
- evidence recall
- graded relevance
- document diversity
- non-redundancy
- grounding

Evaluate an evidence selector using:
- reranker relevance
- document diversity
- duplicate suppression
- supporting chunks
- token budget

Do not simply send the first N chunks to the LLM.

The earlier capped-support aggregation variant may be useful here even though it was rejected for search ranking.

# Phase 15 — RAG evaluation

Evaluate:
- answerable questions
- unanswerable questions
- unauthorized-only evidence
- multi-document questions
- conflicting evidence
- stale/current evidence
- prompt-injection documents

Where reproducible, report:
- citation precision
- citation coverage
- grounded-claim rate
- refusal precision
- refusal recall
- refusal F1
- unauthorized citation count

Do not restore previously withdrawn generation-quality metrics unless reproduced under the current architecture.

# Testing

All existing gates must remain green.

Add targeted tests for:
- candidate union
- reranker depth handling
- deterministic ranking
- identifier detection
- identifier normalization
- ACL preservation
- forbidden candidates never reaching the reranker

Do not weaken existing tests.

If required services are unavailable, report `BLOCKED` or `NOT RUN`, never PASS.

# Reproducibility

Every benchmark run must record:
- git SHA
- benchmark version
- corpus hash
- query hash
- qrel hash
- config hash
- candidate depth
- reranker depth
- retrieval strategy
- embedding model
- reranker model
- environment/hardware
- runtime

Store machine-readable JSON artifacts.

# Working rules

Do not:
- change SaaSBench to improve metrics
- alter qrels after seeing results
- lower structural thresholds
- tune on held-out test
- regenerate easier queries
- use query-class labels at inference
- hide negative experiments
- report oracle values as deployable performance
- fabricate latency
- weaken ACL filtering
- add unrelated technologies for résumé keywords
- claim MRR/nDCG > 0.80 unless actually measured

Keep negative results in the project.

# Definition of done

The work is complete when there is:

1. a frozen benchmark and baseline;
2. union + cross-encoder reranking evaluation;
3. empirically selected candidate/reranker depth;
4. identifier fast-path evaluation;
5. failure analysis;
6. a single frozen retrieval configuration;
7. held-out retrieval metrics;
8. BEIR regression results;
9. a scale curve through 100K;
10. end-to-end latency/load results;
11. permission-regression results;
12. RAG evidence/generation evaluation where runnable;
13. complete claim ledger;
14. no unsupported metrics.

# Final report

Produce a concise final engineering report containing:

## Final architecture
The actual shipping retrieval/RAG flow.

## Retrieval quality
For every scale rung:
- corpus size
- MRR@10
- nDCG@10
- Success@1
- Recall@10
- candidate oracle

## Performance
- p50
- p95
- p99
- QPS
- concurrency

## Security
- exact adversarial test count
- unauthorized retrieval count

## External validity
- SciFact before/after
- NFCorpus before/after

## Negative experiments
What was tested and rejected.

## Claim ledger
Separate:
- MEASURED
- DIAGNOSTIC ONLY
- WITHDRAWN
- BENCHMARK_INVALID
- NOT RUN

## Resume-safe output
Finally propose exactly TWO concise résumé bullets using only measured and defensible results:

1. retrieval architecture + quality + scale
2. security + latency/system engineering

Do not invent any number.

## Final principle

Do not optimize IndexFlow to look impressive.

The benchmark is frozen.

Improve the real retrieval system against it honestly.

The current oracle results already show substantial ranking headroom. Capture that headroom through better ranking, then prove whether the improvement survives scale, latency, and permission constraints.
