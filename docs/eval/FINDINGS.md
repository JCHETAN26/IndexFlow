# Evaluation hardening — findings

Answers to the questions the brief asked, with the run behind each. Method, pre-registered
predictions and the experiments that changed nothing are in [`WORKLOG.md`](WORKLOG.md);
every number is captured in [`apps/web/eval/RESULTS.md`](../../apps/web/eval/RESULTS.md).

---

## 1. Which of the review's hypotheses were confirmed, and which were wrong?

**All three were confirmed on inspection. Two were worse than stated; one mattered less than
expected.**

| Hypothesis | Verdict |
|---|---|
| An unanswerable query caps every metric at 33/34 | **Confirmed, and worse.** The published `R@5 = 97%` was not a score — it was 100% of attainable, simultaneously, for semantic, hybrid and hybrid+rerank. The bootstrap interval on hybrid R@5 was [100%, 100%], a zero-width confidence interval |
| `byKind` leaks tuning queries into 4 of 6 gate rows | **Confirmed.** And it was concealing something: on held-out data hybrid is *not* uniquely best on exact queries — semantic, hybrid and hybrid+rerank all tie at R@1 93% / MRR 1.00 |
| Retrieval depth asymmetry confounds the hybrid result | **Confirmed as a defect, rejected as a confound.** The harness measured all-chunks/10 while production runs 30/30, so no published number described the shipped configuration. The compression mechanism is real and measured — semantic's normalised runner-up rises 0.565 → 0.659 with depth — but equal depth moved held-out hybrid only 0.88 → 0.89 |

**The reviewer's own framing was wrong in one place.** The brief treats overlapping bootstrap
intervals as the reason the semantic/hybrid gap is not a ranking. It also says, correctly, that
this reasoning is invalid — and it is: the paired test resolves the gap the marginal intervals
hide. See §2.

---

## 2. Does "blending hurts" survive the depth fix, and with what statistical support?

**On the in-domain corpus: yes, and it is stronger than before — it is now statistically
supported rather than merely observed.**

```
Δ MRR semantic − hybrid = +0.08 [0.01, 0.16]   excludes zero: yes
```

Marginal intervals overlap (semantic 97% [92–100], hybrid 89% [81–96]); the **paired** interval on
the same data excludes zero. Both strategies are scored on the same queries, so the pairing removes
variance the marginal intervals keep. `RESULTS.md` previously called this gap noise — it was wrong
in its own disfavour.

**As a general claim: no. It does not generalise, and it reverses.**

| corpus | keyword vs semantic | hybrid vs both |
|---|---|---|
| in-domain (17 docs) | semantic **+0.22**, dominant | **−0.08, significantly worse** |
| BEIR SciFact (5,183) | +0.015, not significant | **+0.056 / +0.071, significant** |
| BEIR NFCorpus (3,633) | +0.008, not significant | **+0.032 / +0.023, significant** |

**Hybrid helps when neither leg dominates and hurts when one does.** On 17 documents a weak keyword
leg is averaged into a near-perfect semantic one, which can only drag it down. On both public
corpora the legs are statistically tied and blending significantly beats both. Two independent
confirmations, both pre-registered, plus a third inside the scale curve where only corpus size
varies (§4).

**A finding that cuts the other way:** reranking's benefit over plain hybrid is **+0.03
[−0.03, 0.10], not significant** at n=33. The README presented it as demonstrated. The point
estimate is positive everywhere tested, but 33 queries cannot establish it.

---

## 3. How does the system compare to published BEIR baselines?

**It reproduces them to within about 0.02 nDCG.**

| corpus | metric | ours | published | delta |
|---|---|---|---|---|
| SciFact | BM25 nDCG@10 | **0.646** | ≈0.665 (Thakur et al. 2021) | −0.019 |
| SciFact | all-MiniLM-L6-v2 nDCG@10 | **0.648** | ≈0.645 | +0.003 |
| NFCorpus | BM25 nDCG@10 | **0.299** | ≈0.325 | −0.026 |

I predicted our BM25 would fall short by up to 0.15, reasoning from chunking, Elasticsearch default
parameters and the `title^2` boost. Those differences are real and cost about two nDCG points, not
fifteen. **This is the strongest validity result in the project**: chunking, indexing, embedding,
scoring, metric computation and document-level deduplication together land on the literature.

Our hybrid configuration scores **0.707 on SciFact — above published BM25 (0.665)** — from a
22M-parameter embedding model with no reranker.

---

## 4. How does quality degrade with corpus size?

**Measurably, and the degradation is statistically real.** Fixed query set, nested corpora,
195,980 chunks embedded across 12 parallel CI jobs.

```
docs      chunks    MRR     R@6      nDCG@10   vs 500
500       1,085     0.68     72.3%    68.5%    +0.0pp
5,000     11,155    0.68     79.1%    70.9%    +2.3pp
25,000    49,999    0.63     73.9%    66.2%    -2.3pp
100,000   195,980   0.59     69.2%    61.7%    -6.8pp

Δ MRR (500 − 100,000) = +0.088 [0.025, 0.147]   excludes zero: yes
```

**A 200× corpus costs 6.8 nDCG points.** The decomposition matters more than the headline:

- **The dense leg degrades three times faster than BM25** — semantic loses 16.2 points, keyword 4.2
  from its peak.
- **They cross over.** Semantic leads keyword by 6.2 points at 500 documents and *trails* by 5.8 at
  100,000. Which strategy is better is a function of corpus size, so any claim omitting corpus size
  is unfalsifiable — and the in-domain corpus has 17 documents.
- **The curve is non-monotonic**: 5,000 beats 500, because BM25 needs corpus statistics to estimate
  IDF and 500 documents is not enough. The smallest tier is not the easiest task.
- The degradation is **not** an ANN artifact: recall@10 against exact KNN is 100.0% on real
  embeddings at 195,980 chunks. The embedding model itself stops separating documents.

---

## 5. What is still unproven, and what would it take to prove it?

| Unproven | What it would take |
|---|---|
| **The relevance labels are correct.** Every in-domain number rests on one person's unaudited judgment | `labels:export` emits a blind 20-pair sheet; a human labels it; `labels:score` reports agreement and κ. **Tooling done, labelling not** |
| **Answer quality at scale.** Generation is 32 questions over 17 documents; nothing measures end-to-end answer quality on a realistic corpus — and that is what a user experiences | A RAG eval over the BEIR corpora, needing Ollama in CI or a hosted model |
| **Reranking helps.** +0.03 [−0.03, 0.10] in-domain, unmeasured at scale. But oracle rerank is worth **+7.3pp at k=6**, so the headroom exists | Run the cross-encoder over the BEIR pools; ~11k pairs, an hour of CPU |
| **Prompt-injection resistance and false-refusal rate.** Expanded from 2 to 32 benign queries, but unrun — needs Ollama | An Ollama-capable runner, or a hosted judge |
| **The ACL's cost to ranking quality.** Tested for leaks, never for what filtering does to results for a restricted viewer | Score the same queries as viewers with different grants and compare |
| **In-domain performance at scale.** Everything above 17 documents is out of domain — scientific abstracts, not workspace documents | A large labelled corpus of workspace-like documents |

---

## What I could not verify

Everything below rests on an assumption, a single run, an unaudited label, or a measurement I could
not isolate.

1. **The published BEIR baselines are quoted, not re-derived.** 0.665 and 0.325 for BM25, ≈0.645 for
   MiniLM come from the literature. Only our column is a measurement taken here. The whole external-
   anchor argument in §3 inherits whatever error those citations carry.
2. **The label set is unaudited**, so §1, §2 and the entire in-domain ceiling analysis rest on
   judgments nobody has checked. Under-labelling would deflate recall for every strategy equally —
   invisible in comparisons, wrong in absolute terms.
3. **Every scale-curve tier is a single run.** Only the 500-vs-100,000 comparison was
   significance-tested; the +2.3-point rise from 500 to 5,000 has no error bar.
4. **The scale curve's distractors are TREC-COVID**, deliberately same-genre. The degradation rate
   would differ with a differently-related pool, and unrelated filler would flatter the system.
5. **The 100k tier is a 667-document benchmark with 99,333 distractors**, not a 100k-document
   benchmark. Correct for the question asked; not the same thing as 100k labelled documents.
6. **The generation numbers are inherited from a 2026-07-26 run I did not reproduce.** Faithfulness
   98%, refusal 92%, and the judge calibration are as previously captured. I changed `embed()`
   batching, which they exercise, and did not re-run them.
7. **The adversarial and false-refusal figures are unrun.** The 32-query benign set exists in code
   only. The previously published `0/10` injection figure came from a **hardcoded string**, not a
   measurement — that is fixed, but no run has yet produced a real value.
8. **ANN recall was sampled at 50 queries per scale**, not exhaustively, and only at k=10.
9. **Ingestion throughput was measured on one 4-core runner** with ~450-word documents. Both the
   absolute rate and the concurrency-8 inflection would move on different hardware or document
   sizes. The ~1s Elasticsearch refresh cost is a default-configuration property, not a law.
10. **The stage breakdown attributes the write path by subtraction**, on a second document of the
    same size rather than the same document. It is an estimate. The first version of this
    measurement was wrong by 89 percentage points and I caught it only because the answer was
    implausible — the corrected version is better, not proven.
11. **`DEFAULT_HYBRID_WEIGHT = 0.45` sits on a wide flat plateau** (0.20–0.70 all score 0.98 on the
    in-domain tuning split). It is a plateau centre, not an optimum, and the tuning split's
    composition is the inverse of the held-out split's — 17 exact/13 paraphrase against 15/19.
12. **The in-domain tuning and held-out splits disagree about which strategy is better** (keyword
    leads on tuning, semantic on held-out). The blend weight is therefore selected on data whose
    character is the opposite of the data it is scored on. Stratified splits would fix it; not done.
13. **CI runner variance is not characterised** beyond the three repeats in the latency bench. The
    scale, curve and ingestion runs are single measurements on shared hardware.
14. **I did not verify that `chunkText`'s semantic chunking is sensible** for BEIR documents. It was
    tuned for workspace prose; on scientific abstracts it produced 1.5–2.6 chunks per document and
    the results reproduce published baselines, which is evidence but not proof.
