# IndexFlow — Review Report

**Scope of this review:** README only. Source files, `docs/`, and `apps/web/bench/RESULTS.md`
could not be retrieved. Claims marked **[unverified]** are taken from the README at face value
and should be confirmed against code before going on a résumé.

---

## 1. What is done

| Area | State |
|---|---|
| Ingestion | Upload → MinIO → BullMQ/Redis queue → worker → chunk → embed → Postgres + Elasticsearch. Retry w/ backoff, 3 attempts. `/jobs` status page. |
| Retrieval | Three modes: BM25 (ES), semantic (pgvector cosine), hybrid (min-max normalise + weighted sum, weight 0.4 from sweep). |
| RAG | Local `llama3.2:3b`, strict grounding prompt, `[n]` citations, streamed, refuses when unsupported. |
| Permissions | ACL model (public / owner / user grant / group grant). Enforced independently on both retrieval legs. Self-serve sharing panel. ES ACL re-sync on mutation. |
| Evaluation | Retrieval harness (recall@k, MRR, weight sweep, gate) in CI. RAG hallucination eval + ACL leak test + sharing lifecycle check, on demand. |
| Frontend | Next.js 15 / React 19 / Tailwind v4. Search, documents, upload, jobs, and a live `/eval` page. |
| Infra | Postgres 16 + pgvector, Elasticsearch 8, Redis 7, MinIO, Ollama. Docker Compose. |
| CI | Build + retrieval eval against real ES + pgvector on every PR. `main` protected. |

Not done: public deployment, self-serve group admin, OCR for scanned PDFs.

---

## 2. What is genuinely strong

These are the parts worth leading with. Several are above the level of a typical portfolio project.

**Permission enforcement, and the way it is proven.**
The ACL is applied at the ES index via a denormalised `terms` filter *and* as a SQL predicate on
the pgvector leg — two independent mechanisms that must agree. The leak test drives the *real*
retrieval and answer code rather than a reimplementation, includes the adversarial case where the
restricted document is the single most relevant match, and includes positive controls (owner and
granted group member *do* retrieve it). Positive controls are what separate a real security test
from one that would pass if retrieval were simply broken. **[unverified]**

**The shared retriever requires a `viewer`.**
Making the filter a required argument rather than an optional one means a future call site cannot
silently skip it. This is a type-level safety property, not a convention.

**Chunk IDs generated in application code.**
One ID keys both the Postgres row and the ES document, which is the only reason hybrid blending
can correlate candidates across two stores. Easy to get wrong; correctly identified as load-bearing.

**Evaluation hygiene.**
Ephemeral ES index, rolled-back Postgres transaction, and semantic index scans disabled during
eval so ranking is exact brute-force KNN and results are deterministic. That last detail — refusing
to let ANN approximation contaminate a quality measurement — is a genuinely sophisticated choice.

**Seeding through the real upload endpoint** rather than inserting rows, so demo data traverses
MinIO, the queue, the worker, Postgres and ES exactly as a user's file would. No hardcoded results.

**XSS-safe highlighting in the correct order.** ES emits sentinel tokens, the server escapes the
whole snippet, and only then substitutes `<mark>`. Most implementations escape first and reintroduce
the injection.

**Judge separation in the RAG eval.** Generator is `llama3.2:3b`; judges are `qwen2.5:7b` and
`bespoke-minicheck`. Different models, so no self-preference bias.

**Honest failure reporting.** The two RAG failures are named specifically — a synthesis error on a
combined 504-vs-429 question, and the model naming a CRDT algorithm the corpus never states instead
of refusing. A believable number with a characterised weakness is stronger evidence than a clean 100%.

**Decisions justified with numbers.** Postgres FTS → Elasticsearch is defended with keyword MRR
0.48 → 0.92 on the same corpus, not with a preference.

**The latency benchmark is correctly scoped.** Synthetic vectors, isolated tables, explicitly
labelled as measuring latency and not quality. The diagnosis — flat p50 across a 100× corpus jump,
ES network hop dominating hybrid, tail noise from a shared 8 GB box, index build as the real cost
of scale — is the right reading of the data and stated with the appropriate caveat.

---

## 3. What needs work

### 3.1 CRITICAL — the README contradicts itself on the headline metric

| Location | Hybrid MRR | Semantic MRR | Query count |
|---|---|---|---|
| Highlights table | **0.96** | — | **34** |
| "Why hybrid search" | **0.98** | 0.96 | — |
| Measurement & verification table | **0.98** | — | — |
| Retrieval results block | **0.96** | 0.94 | — |
| Repository layout (`eval/`) | — | — | **27** |

Three separate conflicts: hybrid MRR (0.96 vs 0.98), semantic MRR (0.94 vs 0.96), and benchmark
size (27 vs 34). A reader who notices this discounts every other number on the page — including the
ones that are correct and hard-won. **Fix before anything else.** Pick the number the harness
actually emits, regenerate every table from a single source, and consider having the eval script
write the README block so they cannot drift again.

Related: the highlights claim hybrid outperforms "reranked configurations," but no reranker appears
anywhere else in the README, the stack table, or the repo layout. Either it exists and is
undocumented, or the claim is wrong.

### 3.2 CRITICAL — the eval set is too small and the task is saturated

17 documents, 27 (or 34) queries. Semantic and hybrid both hit **R@5 = 100%**, and hybrid MRR sits
at 0.96–0.98. There is no headroom left: the ceiling has been reached, so the benchmark can no
longer distinguish a good configuration from a slightly better one.

This is the same failure mode already diagnosed elsewhere — an exam that is too easy produces
excellent-looking numbers that prove nothing. The domain-pair selection logic applied in a previous
project (rejecting a pair with baseline MRR 0.9993 because no adapter could show improvement)
applies here verbatim.

**Consequence:** the gap between hybrid (0.96) and semantic (0.94) on 27 queries is roughly *one
query*. It is not a result. It is noise being reported as a finding.

### 3.3 HIGH — no significance testing anywhere

Every retrieval number is a point estimate. With n≈27, the 95% confidence interval on MRR is very
wide — plausibly ±0.10 or worse. The claim "hybrid beats both" is not supported at this sample size.

Bootstrap over queries and report intervals. If they overlap, say so. The tooling is trivial
(resample query results with replacement, 1000 iterations, take percentiles) and it converts the
weakest part of the eval into the most defensible.

### 3.4 HIGH — the hybrid weight is tuned and reported on the same query set

`DEFAULT_HYBRID_WEIGHT = 0.4` is chosen by a sweep over the labeled query set, and then hybrid
performance is reported on that same set. That is fitting a hyperparameter to the test data. The
reported hybrid advantage is inflated by an unknown amount.

**Fix:** split queries into dev and test. Sweep the weight on dev, report all final numbers on test,
untouched. With only 27 queries there is not enough data to split — which is another reason 3.2
must be fixed first.

### 3.5 MEDIUM — no NDCG, and the current label design cannot support it

NDCG is absent. It is also, as the eval is currently constructed, not meaningful: with exactly one
relevant document per query and binary relevance, NDCG@k is a monotone function of reciprocal rank
and carries no information MRR does not already carry.

To report NDCG honestly, the label set needs **graded relevance** (e.g. 0 = irrelevant,
1 = related, 2 = partially answers, 3 = directly answers) and/or **multiple relevant documents per
query**. This is worth doing: it is the metric most interviewers expect for retrieval, and graded
labels also make the benchmark harder in a useful way, because a system can then be wrong about
*ordering* rather than only about *finding*.

### 3.6 MEDIUM — the security tests are not in CI

The permission leak test is the single most valuable check in the repository, and it is on-demand
only. A retrieval regression fails the build; an ACL regression does not. That is backwards for a
system whose central claim is permission-awareness.

The stated reason (writes live fixtures) is solvable the same way the retrieval eval already solves
it — ephemeral index plus rolled-back transaction. The pattern exists in the codebase already.

### 3.7 MEDIUM — small denominators throughout the RAG eval

- Refusal correctness 92% on 12 unanswerable questions = 11/12. One item moves it 8 points.
- Faithfulness 98% on 20 answerable questions.
- Answer relevance, citation correctness, and context recall all at **100%** — which, on 20 items,
  most likely indicates the questions are too easy rather than that the system is flawless.
- ACL: 9/9 checks, 0 leaks across 40 adversarial queries. The strongest of the four, still small.

Target 100+ items per eval before treating any of these as a stable measurement.

### 3.8 LOW — deployment and remaining gaps

Not deployed to a public URL. Groups are seeded rather than self-serve. No OCR. 10 MB upload cap.
The first of these is the one that matters: a live link changes how the whole project reads.

---

## 4. Improvements, in priority order

1. **Reconcile every number in the README against a single harness output.** Half a day. Highest
   value-per-hour item in the project.
2. **Grow the eval corpus to 300–1000 documents and 150+ queries.** This unblocks items 3, 4, and 5
   and is the difference between a benchmark and a demo. Options: a public corpus with existing
   relevance judgements (BEIR subsets such as SciFact or NFCorpus, or FiQA), or synthesised queries
   over a large real corpus with manual verification of a sample.
3. **Add an external benchmark run.** Reporting IndexFlow's numbers on a BEIR subset gives every
   metric a public reference point, and directly answers "compared to what?"
4. **Add graded relevance labels and report NDCG@10 alongside MRR and recall.**
5. **Bootstrap confidence intervals on every retrieval metric; refuse to declare a winner when
   intervals overlap.** This is a differentiator, not just a correctness fix — nearly every RAG eval
   tool reports bare point estimates.
6. **Split dev/test queries so the weight sweep is honest.**
7. **Move the ACL leak test into CI.**
8. **Deploy.** A public URL with the demo corpus preloaded.
9. **Add a reranker as a measurable configuration** (e.g. a cross-encoder over top-50). Either it
   helps and you have a stronger system, or it does not and you have a finding worth writing up.
   Also resolves the undocumented "reranked configurations" claim.
10. **Expand the adversarial ACL set beyond 40** and add prompt-injection cases where retrieved
    document *content* attempts to alter the grounding prompt.

---

## 5. Metrics to report

### 5.1 Retrieval quality

| Metric | Why | Current | Target state |
|---|---|---|---|
| **NDCG@10** | Standard for ranked retrieval; expected by interviewers | absent | Report with graded labels, per strategy, with CI |
| **MRR@10** | Rank of the first relevant result | 0.96 / 0.98 (conflicting) | Single reconciled figure, CI, on 150+ queries |
| **Recall@1 / @5 / @10** | Coverage | 91 / 100 / — | Re-measure on a corpus where R@5 < 100% |
| **Per-strategy delta** | Whether hybrid is actually justified | 1-query difference | Bootstrap CI; state plainly if not significant |
| **By query kind** | Where each strategy wins | exact vs paraphrase | Keep — good analysis, needs more queries |

Always report alongside: corpus size, query count, and how the labels were produced. A metric
without those three is not checkable.

### 5.2 Generation quality

| Metric | Current | Note |
|---|---|---|
| Faithfulness (judge-scored) | 98% / 20 items | Needs 100+ items |
| Refusal correctness | 92% / 12 items | 11/12 — report the fraction, not just the percent |
| Citation correctness | 100% / 20 items | 100% on 20 signals an easy set |
| Context recall | 100% | Same |

Report generator and judge model names inline — the separation is a methodological strength and
should be visible in the metric, not buried in prose.

### 5.3 Security / permissions

| Metric | Current | Note |
|---|---|---|
| ACL leak rate | 0 / 40 adversarial queries | The strongest single claim in the project |
| Positive-control pass rate | 9/9 | Prevents "passes because retrieval is broken" |
| Sharing lifecycle consistency | 8/8 | Both legs update on mutation |
| Prompt-injection resistance | not measured | Add: injected instructions inside indexed document content |

### 5.4 Performance and scale

| Metric | Current | Note |
|---|---|---|
| p50 / p95 retrieval latency by strategy and scale | table at 1k / 10k / 50k / 100k | Good. Keep the caveat about shared hardware |
| Corpus scale tested | 100,000 vectors | Checkable, concrete |
| HNSW index build time vs scale | 0.1 s @ 1k → 24 s @ 100k | The correct identification of the real scaling cost |
| Ingestion throughput | not measured | Add: documents/sec through the worker |
| Keyword-leg overhead | identified as ES network hop | Quantify it — ES round-trip vs in-process pgvector |

---

