# Claim ledger

Every claim the remediation produces, with the evidence behind it and whether it may appear on a
résumé. A claim is résumé-safe only when it is reproducible, correctly scoped, has its limitations
documented, describes the current implementation, and is not contradicted by another benchmark.

Statuses: `VERIFIED` · `UNVERIFIED` · `WITHDRAWN` · `SUPERSEDED` · `BLOCKED`

This file governs the remediation only. The pre-existing withdrawn-claims blacklist in
[`../indexflow-project-overview.md` §11](../indexflow-project-overview.md) remains in force, and
nothing here reinstates any of it.

---

## Phase 1 — ingestion throughput

| Claim | Metric | Evidence | Status | Résumé safe |
|---|---:|---|---|---|
| Forcing the Elasticsearch refresh instead of awaiting the scheduled one raised per-worker ingestion throughput 6.2× | 1.00 → 6.15 docs/s @ concurrency 1 | CI [before](https://github.com/JCHETAN26/IndexFlow/actions/runs/31925524370) / [after](https://github.com/JCHETAN26/IndexFlow/actions/runs/31925857101), 4 vCPU, shipping code, 3 passes, neither flagged | **VERIFIED** | **Yes** — with "per worker" stated; it is not the saturation figure |
| …and 1.8× at saturation | 4.67 → 8.23 docs/s @ concurrency 8 | same | **VERIFIED** | **Yes** |
| Per-document ingestion latency fell from ~1 s to 144 ms | p50 1006 → 144 ms | same | **VERIFIED** | **Yes** |
| The write path fell from 88.3% of ingestion to 3.4%, making embedding the dominant stage | 420.1 → 7.7 ms | same, stage breakdown | **VERIFIED** | **Yes** |
| ~12× / 2.4× (the workstation figures) | 0.99 → 11.81 docs/s | 8-core workstation, build D | **SUPERSEDED** by the CI pair | **No** — the ratio does not transfer across machines; on 4 vCPU it is 6.2× |
| The shipping code passes every correctness gate | see below | §8 | VERIFIED | Yes |
| The throughput floor was `wait_for` blocking on the 1 s `refresh_interval`, not the pipeline's work | refreshes/doc identical across all four builds (1.02/0.50/0.25/0.13) | ES `refresh.total` counters read per run | VERIFIED | Yes — as a mechanism, without numbers |
| The optimisation preserves read-your-write and cross-store consistency | 23/23 integration, 8/8 consistency, 8/8 sharing, 8/8 leak | [`ingestion-benchmark.md`](ingestion-benchmark.md) §7 | VERIFIED | Yes |
| Batching the projection improves throughput | 0% / −3.5% / −6.6% / +1.8% | §4; ranges overlap at 3 of 4 levels | **WITHDRAWN** | **No** — it does not, and is slower still once the refresh is forced |
| "Two forced ES refreshes per document" (Phase 9c) | — | §4 | **SUPERSEDED** | Only true for re-ingest and ACL change, not first-time ingest |
| Ingestion throughput is 4.5 docs/s | 4.5 docs/s | CI run 31154323242 | SUPERSEDED by Phase 1 pending the CI re-run | Not alongside the new figure |
| Forced refresh is safe at corpus scale | — | not measured; 40-document runs only | **UNVERIFIED** | **No** — see §6.1, revisit at Phase 6's 100K load |
| Re-ingest and ACL-change paths improve similarly | — | not measured | **UNVERIFIED** | **No** |

### Phase 1 résumé candidates

Both are now backed by CI runs on the shipping code and are cleared for use.

> Profiled an asynchronous document-ingestion pipeline to the Elasticsearch refresh that bounded it,
> and raised throughput **6.2× per worker (1.00 → 6.15 docs/s) and 1.8× at saturation
> (4.67 → 8.23 docs/s), cutting per-document p50 from 1006 ms to 144 ms**, by forcing the index
> refresh rather than awaiting the scheduled one — preserving the read-your-write guarantee, with
> all 23 cross-store consistency and permission tests passing unchanged.

Quote both numbers, not just the 6.2×. The gain is large for one worker and modest at saturation
because CPU-bound embedding becomes the constraint once the refresh stops blocking, and a bullet
that gives only the larger figure describes a system nobody runs.

The honest alternative, which needs no CI confirmation and is arguably the better story:

> Built a batched Elasticsearch projection to fix a measured ingestion bottleneck, instrumented the
> engine's own refresh counters to verify it, and found the batching contributed nothing — the
> 89%-of-runtime cost was a one-line `wait_for` blocking on a 1 s refresh clock. Discarded the
> batching, shipped the one line, and recorded both predictions it falsified.

---

## Phase 2/3 — SaaSBench generator and quality gate

| Claim | Metric | Evidence | Status | Résumé safe |
|---|---:|---|---|---|
| Built a synthetic SaaS benchmark with document and query vocabularies that share no content word, enforced as a test | 18 concepts, 0 leaks | [`saasbench-design.md`](saasbench-design.md) §1; `test/unit/saasbench.test.ts` | **VERIFIED** | **Yes** |
| The disjointness check caught 9 of 18 concepts leaking on first authoring | 9/18 | same | **VERIFIED** | **Yes** — it is the strongest evidence the mechanism is real |
| The benchmark discriminates: strategies separate by 0.061 nDCG@10, CI excluding zero | 0.061 [0.037, 0.085] | §4, paired bootstrap, 895 test queries | **VERIFIED** | **Yes** — at 3,400 documents only |
| Lexical retrieval wins token-matching classes, dense wins vocabulary-gap classes | identifier 0.868 vs 0.038; troubleshooting 0.101 vs 0.186 | §4 per-class table | **VERIFIED** | **Yes** — name the corpus |
| The quality gate rejected the generator five times, each on a real construction defect, with no threshold relaxed | 5 failures | §6 | **VERIFIED** | **Yes** — this is the strongest story in the phase |
| Queries and qrels are invariant to corpus size | hashes equal at 3,400 and 5,000 | `saasbench.test.ts` | **VERIFIED** | **Yes** |
| Absolute nDCG@10 figures (keyword 0.238 etc.) | — | §4 | **VERIFIED at 3,400 docs** | Only with the corpus size stated; they are not comparable to BEIR |
| SaaSBench separation survives to 100K | — | not measured | **UNVERIFIED** | **No** — that is what the scale curve is for |
| SaaSBench exercises the production chunking path | 1.00 chunks/document | §7.1 | **WITHDRAWN** | **No** — it exercises document-level retrieval only |
| SaaSBench scores predict production quality | — | §7.2 | **UNVERIFIED** | **No** — the corpus omits user-voice text and is harder than reality |
| Permission-aware retrieval quality | — | scored against global qrels, not authorized | **UNVERIFIED** | **No** — Phase 8 |

### Phase 2/3 résumé candidate

> Designed a 3,400-document synthetic SaaS retrieval benchmark with graded relevance, permission
> metadata and adversarial near-miss distractors, built on paired document/query vocabularies that
> are enforced disjoint by test — then wrote an acceptance gate that rejected the generator **five
> times**, each on a construction defect that had produced plausible-looking retrieval numbers
> (relevant sets inflated to 72 documents; near-miss distractors sharing every queryable attribute
> with their target), and fixed the generator rather than relaxing a threshold.

The gate story is worth more than any score it produced. A benchmark that passes its own quality
audit on the first attempt has usually not been audited.

---

## Phases 6/7 — scale curve

| Claim | Metric | Evidence | Status | Résumé safe |
|---|---:|---|---|---|
| SaaSBench corpora are nested, so a scale curve grows only the haystack | prefix check at 3,600 vs 4,200 | [`scale-evaluation.md`](scale-evaluation.md) §1 | **VERIFIED** | Yes — as a design property |
| Incremental indexing is equivalent to rebuilding each rung | rung 3,400 reproduces the gate exactly (0.238 / 0.168 / 0.250) | §1 | **VERIFIED** | Yes |
| Hybrid beats both legs on SaaSBench | 0.250 vs 0.238 / 0.168 | [`saasbench-design.md`](saasbench-design.md) §4 | **VERIFIED at 3,400 documents** | Yes — with the corpus size stated |
| Chunking changed which strategy wins | keyword led at 1.00 chunks/doc; hybrid leads at 2.25 | `saasbench-design.md` §4 | **VERIFIED** | Yes — a good methodology story |
| Retrieval quality degrades by X across a 30× corpus | — | **no rung above 3,400 measured** | **BLOCKED** | **No** — there is no scale result |
| SaaSBench hybrid advantage survives to 100K | — | not measured | **UNVERIFIED** | **No** — BEIR already showed the winner is a function of corpus size |

### Phase 6/7 status

**BLOCKED on compute, not design.** Measured cost: 23 chunks/s embedding and 0.49 s/query retrieval
under exact KNN, against a ladder needing ~225,000 chunks. That is ~2.8 hours of embedding alone and
does not fit a 45-minute CI job. Requires sharded embedding (the Phase 9a pattern, 12 parallel jobs)
and ANN above the small rungs with a fresh recall check on this corpus.

---

## Phase 4 — corrected benchmark, baseline and diagnostics

Benchmark: generator `2.0.0`, corpus `361c493cc643`, queries `234bb5777c46`, qrels `6ebf63330749`.

### BENCHMARK_INVALID — never a baseline, never résumé-safe

| Construction | Numbers produced | Why invalid |
|---|---|---|
| `1.0.0-collided` | keyword 0.238 / semantic 0.168 / hybrid 0.250 nDCG@10 | 135 of 150 core scenarios shared an anchor and 18 shared anchor AND fault; queries could not identify a target. **Artificially low.** |
| `1.0.0-unique` | keyword 0.612, hybrid MRR 0.840, keyword MRR 0.896, Success@1 83.5% | One service per scenario made the anchor a document identifier; BM25 reached 0.659 on a disjoint-vocabulary class. **Artificially high.** |

Both remain in the repository as recorded negative results. Neither may be quoted.

### MEASURED — the valid baseline

| Claim | Metric | Evidence | Status | Résumé safe |
|---|---:|---|---|---|
| Shipping hybrid on corrected SaaSBench | nDCG@10 0.297 · MRR@10 0.623 · Success@1 45.5% | [`retrieval-diagnostics.md`](retrieval-diagnostics.md) Q2, n=894 test | **MEASURED** | Yes — with corpus size (3,400) stated |
| Hybrid fusion beats both legs on MRR | 0.623 vs 0.512 / 0.513 | Q2 | **MEASURED** | Yes |
| Union candidate recall@100 | 84.8% | Q3 | **MEASURED** | Yes |
| Dense adds ranking signal, not coverage | union R@100 84.8% vs keyword 83.8%; hybrid MRR 0.623 vs keyword 0.512 | Q3 | **MEASURED** | Yes — a good mechanism claim |
| Chunk multiplicity does not consume candidate capacity | 95.7 unique docs per 100 keyword chunks | Q4 | **MEASURED** | Yes |
| Tail-drop fix changed no measured quality | Δ nDCG@10 0.000 [0.000, 0.000], n=894 | Q5 | **MEASURED (negative)** | Yes — as a correctness fix, with **no** improvement claimed |
| Legacy fusion silently dropped candidates | 5.68/query, max 146 | Q5 | **MEASURED** | Yes |

### DIAGNOSTIC ONLY — not deployable, not a system result

| Claim | Metric | Status |
|---|---:|---|
| Oracle ceiling over candidate union @30 | nDCG@10 0.693 · MRR@10 0.996 · S@1 99.6% | **DIAGNOSTIC** — uses ground truth |
| Oracle ceiling over candidate union @100 | nDCG@10 0.927 · MRR@10 1.000 · S@1 100% | **DIAGNOSTIC** — uses ground truth |
| "Ranking, not retrieval, is the bottleneck" | oracle 0.927 vs shipping 0.297 | **MEASURED as an inference from diagnostics** | 

### REJECTED after measurement

| Experiment | Result | Decision |
|---|---:|---|
| Document aggregation C (best chunk + capped support) | +0.038 nDCG [0.020, 0.056] but −0.024 MRR, −3.6pp Success@1 | **Rejected for search ranking** — trades first-result quality for breadth. Retained as a RAG evidence-selection candidate. |
| Document aggregation B (per-leg best chunk) | +0.004 [0.001, 0.007] | Significant, negligible. Not adopted. |

### NOT RUN / OUTSTANDING

| Item | Status |
|---|---|
| Dense-leg anchor ablation | **IN PROGRESS** — keyword-leg ablation alone is uninformative by construction |
| Union → cross-encoder reranking | **IN PROGRESS** (depth sweep, tune split) |
| Identifier fast path | **NOT RUN** — evidence supports evaluating it (keyword MRR 1.000 vs hybrid 0.648) |
| SaaSBench scale curve to 100K | **BLOCKED** — needs sharded CI embedding |
| Concurrent load / end-to-end latency | **NOT RUN** |
| RAG evaluation under current architecture | **NOT RUN** — previously withdrawn generation metrics stay withdrawn |
