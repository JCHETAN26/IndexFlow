# Remediation Phases 6–7 — SaaSBench scale curve

**Status: BLOCKED on compute, not on design.** The runner is built and its correctness is
established at the first rung. A complete curve has not been produced: the full ladder needs
sharded embedding in CI, and exact KNN does not survive to the top rung. §3 states exactly what is
required.

---

## 1. What is built and verified

`eval/saasbench/scale-run.ts` runs the frozen query set against a growing corpus and reports
nDCG@10, MRR@10, R@10 and Success@1 per strategy per rung, plus retention and a paired bootstrap
between the smallest and largest rung.

Two generator properties make the design affordable, and both are verified rather than assumed:

- **Corpora are nested.** The document list at 3,600 is an exact prefix of the list at 4,200
  (checked directly). The labelled core is fixed and filler is drawn from one deterministic stream,
  so growing the corpus only ever appends. Vectors are therefore computed once at the largest size
  and reused by every rung.
- **Incremental indexing is equivalent to rebuilding.** Each rung adds its tranche to the same
  Elasticsearch index and the same Postgres transaction. Rung 3,400 of the incremental run scores
  **keyword 0.238 · semantic 0.168 · hybrid 0.250** — identical to the gate's independent
  from-scratch measurement of the same corpus.

That second check is the one worth having. The cheap alternative — index everything once, filter
out-of-rung hits afterwards — would have been wrong in a way that is invisible in the output: BM25's
IDF depends on corpus composition, so a document's score at 5,000 documents is not its score at
100,000 with the extras hidden, and the KNN neighbourhood shifts too. The smaller rungs have to be
real corpora, and now demonstrably are.

## 2. Measured cost

On an 8-core workstation with co-located services:

| stage | measurement |
|---|---|
| Embedding | 17,769 chunks in 786 s ≈ **23 chunks/s** |
| Retrieval | 902 queries at 7,651 chunks in 441 s ≈ **0.49 s/query**, exact KNN |
| Chunk yield | 2.25 chunks per document |

Extrapolating the full ladder (3,400 → 100,000 documents ≈ **225,000 chunks**):

- Embedding alone: ~9,900 s ≈ **2.8 hours**, single-threaded, before any retrieval.
- Retrieval at the top rung under exact KNN scales with corpus size — roughly 30× the per-query cost
  measured at 7,651 chunks, across 902 queries and six rungs.

Neither fits a 45-minute GitHub Actions job, and both are impractical locally.

## 3. What the full ladder requires

1. **Sharded embedding in CI.** Phase 9a already solved this shape for BEIR: 12 parallel jobs
   embedding disjoint shards, artifacts passed between jobs (301 MB of raw float32 at 196K
   embeddings). SaaSBench needs the same, at ~225K embeddings.
2. **ANN instead of exact KNN above the small rungs.** `scale-run.ts` currently forces exact search
   (`SET LOCAL enable_indexscan = off`) for correctness. That is right at 7,651 chunks and
   unaffordable at 225,000. The project already measured **ANN recall@10 at 100.0% on real
   embeddings at 195,980 chunks**, so HNSW is defensible here — but the recall check must be re-run
   on *this* corpus rather than inherited, because recall depends on the embedding distribution.
3. **A rung-level artifact contract**, so a failed job resumes rather than restarting the ladder.

## 4. Ladder

The brief's ladder starts at 1,000. **The floor is 3,367** — the labelled core plus its near-miss
siblings, which is fixed across scales by design. Documents below that cannot be dropped without
deleting documents the qrels point at. So the ladder is:

```
3,400 → 5,000 → 10,000 → 25,000 → 50,000 → 100,000
```

At the top rung the labelled core is 3.4% of the corpus, which is a reasonable distractor ratio —
and unlike the BEIR scale curve, **every document is in-domain** rather than 667 labelled among
99,333 TREC-COVID distractors.

## 5. What must not be claimed yet

- **No scale result exists.** One rung has been measured, and it is the smallest. Nothing here says
  anything about degradation with corpus size.
- **The hybrid-beats-both finding is a 3,400-document result.** Whether it survives to 100,000 is
  the open question, and the in-domain corpus has already taught this project that which strategy
  wins is a function of corpus size — semantic led by 6.2 points at 500 documents and trailed by 5.8
  at 100,000 on BEIR.
- `SAASBENCH_MAX_QUERIES` caps the query set for mechanism smoke runs and prints a warning. Any
  curve produced with it set is not publishable.
