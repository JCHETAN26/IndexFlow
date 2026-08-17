# Retrieval diagnostics — where IndexFlow's quality is actually lost

**One sentence: the right documents are being retrieved and then ranked badly.** Union candidate
recall at depth 100 is 84.8%, a perfect ranker over those same candidates would score 0.927 nDCG@10,
and the shipping system scores 0.297. The bottleneck is ranking, not first-stage retrieval, and
every recommendation below follows from that.

Benchmark: SaaSBench generator `2.0.0`, corpus `361c493cc643`, queries `234bb5777c46`, qrels
`6ebf63330749`, 3,400 documents / 7,657 chunks (2.25 per document), 227 tune / 894 test judged
queries, candidate depth 300 chunks per leg, `Xenova/all-MiniLM-L6-v2`, hybrid weight 0.45.
Artifacts in `apps/web/eval/saasbench/results/`.

---

## Q1 · Is the benchmark structurally valid?

Yes, with one open question.

All five structural rules pass: no anchor identifies a single scenario, no anchor hosts two
scenarios with the same fault, every anchored query has same-anchor competitors, and no paraphrase
query shares discriminative vocabulary with its target's documents. 150 core scenarios across 30
anchors, exactly 5 per anchor.

**Open**: the keyword-leg ablation trips both warning thresholds — anchor-only reaches 95% of full
(0.150 vs 0.158) and anchor-masked collapses to 9% (0.014). I do not read that as entity leakage,
because the vocabularies are deliberately disjoint and BM25 therefore has nothing *but* the anchor;
anchor-only exceeding full simply means symptom words are noise to a lexical matcher. The decisive
test is the same ablation on the **dense** leg, which was not part of the original implementation
and is being measured now. Until it lands, benchmark validity is "structurally sound, one
diagnostic outstanding" rather than settled.

## Q2 · What is the clean shipping baseline?

Legacy fusion, exactly as it ships. **This is the first trustworthy SaaSBench baseline.**

| split | strategy | nDCG@10 | MRR@10 | Success@1 | R@5 | R@10 |
|---|---|---|---|---|---|---|
| test (n=894) | keyword | 0.292 | 0.512 | 37.2% | 15.4% | 26.7% |
| | semantic | 0.222 | 0.513 | 37.5% | 12.2% | 19.8% |
| | **hybrid** | **0.297** | **0.623** | **45.5%** | 16.4% | 26.7% |
| tune (n=227) | hybrid | 0.294 | 0.623 | 46.3% | 16.1% | 27.2% |

Tune and test agree closely, which is a good sign for the split.

Per class (test, nDCG@10 / MRR@10):

| class | n | keyword | semantic | hybrid |
|---|---|---|---|---|
| identifier | 120 | **0.876 / 1.000** | 0.017 / 0.077 | 0.290 / 0.648 |
| numeric | 121 | **0.402 / 0.749** | 0.217 / 0.510 | 0.351 / 0.668 |
| ambiguous | 17 | **0.306 / 0.563** | 0.130 / 0.304 | 0.199 / 0.443 |
| hard-negative | 118 | 0.165 / 0.386 | 0.306 / 0.657 | **0.322 / 0.676** |
| paraphrase | 117 | 0.172 / 0.429 | 0.273 / 0.636 | **0.296 / 0.649** |
| troubleshooting | 121 | 0.148 / 0.357 | 0.230 / 0.564 | **0.295 / 0.580** |
| version | 123 | 0.165 / 0.366 | 0.277 / 0.596 | **0.291 / 0.606** |
| multi-document | 120 | 0.147 / 0.322 | 0.251 / 0.567 | **0.256 / 0.563** |
| permission-sensitive | 37 | 0.172 / 0.395 | 0.206 / 0.575 | **0.267 / 0.623** |

Hybrid MRR (0.623) beats both legs (0.512, 0.513) by a wide margin — fusion is earning its place
overall even though it is well short of the ceiling.

## Q3 · Candidate generation or ranking?

**Ranking, decisively.**

| depth | keyword R@k | semantic R@k | union R@k |
|---|---|---|---|
| 10 | 26.7% | 19.8% | 26.8% |
| 30 | 50.4% | 39.7% | 54.0% |
| 50 | 66.4% | 52.0% | 67.7% |
| 100 | 83.8% | 68.0% | **84.8%** |

Oracle over the union — **DIAGNOSTIC ONLY · NOT DEPLOYABLE · NOT A SYSTEM RESULT · NOT RÉSUMÉ-SAFE**:

| depth | oracle nDCG@10 | oracle MRR@10 | oracle Success@1 |
|---|---|---|---|
| 30 | 0.693 | 0.996 | 99.6% |
| 100 | **0.927** | **1.000** | **100%** |

At depth 30 a perfect ranker would put a relevant document first for 99.6% of queries. The shipping
system manages 45.5%. That gap is the entire opportunity.

**A second finding inside this one:** union R@100 (84.8%) barely exceeds keyword alone (83.8%), so
the dense leg contributes almost nothing to candidate *coverage* — yet hybrid MRR (0.623) far
exceeds keyword MRR (0.512). Dense retrieval is supplying ranking signal, not reach. That is worth
remembering before anyone proposes replacing the embedding model to "improve retrieval".

## Q4 · How much candidate depth is wasted on repeated chunks?

**Almost none — this concern does not survive measurement.**

| leg | depth | unique documents (mean) | wasted |
|---|---|---|---|
| keyword | 100 | 95.7 | 4.3% |
| semantic | 100 | 93.0 | 7.0% |
| keyword | 30 | 29.7 | 1.0% |
| semantic | 30 | 29.4 | 2.1% |

At 2.25 chunks per document, multiplicity is not consuming candidate capacity. I had flagged this as
a likely problem and it is not one. No chunking redesign is justified by this evidence.

## Q5 · Did fixing the real hybrid bug change quality?

**No, and that is the honest answer.**

The legacy path silently discarded **5.68 candidates per query (max 146)** — real, and the fix is
correct. Measured impact at top-10:

```
Δ nDCG@10 = 0.000  [0.000, 0.000]   n=894
```

Exactly zero, because every dropped candidate sat deep in the tail, far below rank 10. **No ranking
improvement is claimed for this fix.** It ships on correctness alone. It should start to matter once
anything consumes candidate depth — union reranking in particular.

## Q6 · Does pre-fusion document aggregation help?

**Mixed, and rejected for search ranking.** Tune split only.

| variant | nDCG@10 | MRR@10 | Success@1 | R@10 |
|---|---|---|---|---|
| A — chunk fusion → first-occurrence (current) | 0.294 | 0.623 | 46.3% | 27.2% |
| B — per-leg best-chunk → document fusion | 0.299 | 0.623 | 46.3% | 27.6% |
| C — best chunk + capped supporting chunks | **0.333** | 0.599 | 42.7% | **31.4%** |

B: +0.004 [0.001, 0.007] — statistically significant, practically negligible.
C: +0.038 [0.020, 0.056] on nDCG **but −0.024 MRR and −3.6pp Success@1.**

C trades first-result quality for breadth: it surfaces more relevant documents inside the top ten
while pushing the single best one down. For search, MRR@10 and Success@1 are the metrics that
describe what a user experiences, so **C is not adopted.** It is retained as a candidate for RAG
evidence selection, where breadth and graded relevance matter more than rank 1.

Note also that first-occurrence collapse is *not* inherently wrong: with chunks already score
ordered, it is equivalent to taking each document's best chunk. The concern was candidate-slot
consumption, and Q4 shows that is not happening.

## Q7 · What should the next phase be?

Following the evidence, not the older plan.

1. **Union → cross-encoder reranking.** Highest expected value by a wide margin. The oracle says the
   documents are already in the pool (MRR 0.996 at depth 30) and `Xenova/bge-reranker-base` is
   already in the stack. Reranking the union rather than the post-fusion shortlist matters, because
   fusion is what is burying candidates today.
2. **Deterministic identifier fast path.** Keyword MRR on identifier queries is **1.000** against
   hybrid's 0.648 — a large structural gap, detectable by regex without touching benchmark labels.
   This is the first *uncontaminated* evidence that supports routing; every earlier argument for it
   came from a benchmark-invalid run.
3. **Not** an embedding bakeoff. Dense recall is not the binding constraint (Q3), and replacing
   MiniLM would target coverage the system does not lack.
4. **Not** a chunking redesign (Q4).

---

## What this does not establish

- Everything here is the **3,400-document** rung. Nothing says the ranking headroom, or the
  keyword/dense split, survives to 100K.
- Oracle numbers use ground truth and are ceilings, not achievable performance.
- The dense-leg ablation is outstanding; until it reports, "the benchmark measures problem
  semantics rather than entity matching" is an argument, not a measurement.
- No latency, load, or permission-regression numbers are produced by this run. Retrieval here runs
  without an ACL filter, as the other quality evals do; permission enforcement is covered by the
  separate leak and sharing suites, which pass.
