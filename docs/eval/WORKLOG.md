# Evaluation hardening — worklog

Append-only chronological record. Hypotheses, pre-registered predictions, commands, raw output,
conclusions — including the experiments that changed nothing.

Ground rules in force (from `apps/web/eval/improvements&adjustments.md`): never report a number not
produced in this session; report the number that hurts; never tune on the held-out split;
pre-register predictions *before* running; verify the instrument before fixing anything downstream.

---

## 2026-08-04 — Phase 0: understand the system

**Status: static reading only. No code executed against services, no eval run.** Everything below
is read off source or computed from the label files with a local script; nothing here is a
measurement of retrieval behaviour.

### Files read

`apps/web/eval/{harness.ts,run.ts,queries.json,corpus.json,RESULTS.md}`,
`apps/web/lib/{hybrid.ts,es.ts,embed.ts,chunk.ts,rerank.ts,retrieve.ts}`,
`apps/web/app/api/search/route.ts`, `apps/web/bench/latency-bench.ts`, `.github/workflows/ci.yml`.

### Q1 — retrieval depth: harness vs production

| Leg | Harness | Production |
|---|---|---|
| Keyword | `keywordSearch(q, null, chunks.length, esIndex)` — `harness.ts:282` | `fetchKeyword(...)` → `CANDIDATE_LIMIT = 30` — `retrieve.ts:25,62` |
| Semantic | raw SQL `LIMIT 10` — `harness.ts:321` | `fetchSemantic(...)` → `CANDIDATE_LIMIT = 30` — `retrieve.ts:25,87` |

**They are not the same. The eval does not measure the configuration that ships.**

Production is symmetric (30/30). The harness is asymmetric (all-chunks / 10).

Magnitude, computed from `corpus.json`: all 17 documents are 37–54 words (mean 47), and
`chunk.ts` uses `TARGET_WORDS = 180`. **Every document produces exactly one chunk — 17 chunks
total.** Three consequences:

1. `chunks.length` is 17, so the keyword leg's "depth" is the entire corpus. It returns fewer only
   because `multi_match` with `operator: "or"` drops non-matching chunks.
2. The semantic leg's `LIMIT 10` is a real restriction: it can see at most 10 of 17 documents, and
   is structurally unable to rank a document lying outside its top 10 at any *k*. This is
   *tighter* than production, so the harness understates semantic recall relative to what ships.
3. Chunk-level ranking is document-level ranking. `dedupDocs` is a no-op on this corpus. The task
   is "rank 17 documents", which is why depth and recall interact so strongly here.

Related defect: `run.ts:33` prints `* Initial retrieval: 10 chunks per strategy` as provenance.
That is false for the keyword leg, and the false line is captured verbatim in `RESULTS.md:54`.

### Q2 — what `blendHybrid` does to scores

`lib/hybrid.ts`. Per leg, min-max normalise to [0,1] keyed by chunk id, then
`score = w·kw + (1−w)·sm`, `w` = keyword weight.

- **Does it drop zeros?** No. The output id set is the *union* of both legs. A chunk absent from a
  leg contributes exactly `0` for that component.
- **What happens to a leg's lowest-scoring hit?** `(min − min) / range = 0`. **The worst hit in a
  list is scored identically to a document that leg never retrieved at all.** Retrieved-but-last
  and not-retrieved are indistinguishable after normalisation. With the semantic leg capped at 10,
  its 10th-best neighbour is always discarded to 0.
- **Degenerate case:** `range === 0` (all scores equal) maps every item to `1`, not `0` —
  deliberate, per the comment at `hybrid.ts:26`, but it means a leg with no discrimination votes
  at full strength for everything it returned.
- Min-max is scale-free but not shape-free: it stretches whatever spread it is given to fill
  [0,1]. A tight cluster of 10 cosine values and a long-tailed 17-item BM25 distribution are
  stretched to the same range despite carrying different information. This is the mechanism behind
  the Phase 3 hypothesis.

**Unrelated live discrepancy (carried over from the previous review):** the sweep selects `0.55`
(`RESULTS.md:73`) and the README documents `0.55`, but `DEFAULT_HYBRID_WEIGHT = 0.4`
(`hybrid.ts:12`) is what production serves (`retrieve.ts:155`, `search/route.ts:65`). The harness
reports at its own swept weight, so published hybrid numbers describe a blend the app does not run.

### Q3 — which gate rows are held-out, which are whole-set

`byKind` is built from `exact`/`para`, which filter `evals` (tune + test) — `harness.ts:429-430` —
not `headlineRows`. `report.strategies` correctly uses `headlineRows` (`harness.ts:475,507`).

| # | Gate row | Source | Split |
|---|---|---|---|
| 1 | keyword R@1 on exact | `byKind` | **whole set (leaks tuning)** |
| 2 | semantic R@1 on paraphrase | `byKind` | **whole set (leaks tuning)** |
| 3 | semantic MRR overall | `strategies` | held-out |
| 4 | hybrid R@5 overall | `strategies` | held-out |
| 5 | hybrid best on exact queries | `byKind` | **whole set (leaks tuning)** |
| 6 | hybrid does not collapse on paraphrase | `byKind` | **whole set (leaks tuning)** |

**4 of 6 gate rows include the 30 queries that selected the blend weight.** Confirms the Phase 5
hypothesis. Note the `byKind` *table* in the run output is honestly labelled "whole set"
(`run.ts:49`); it is the *gate* that consumes it without disclosure.

### Ceiling arithmetic (Phase 2 hypothesis, verified analytically)

`queries.json` holds 64 queries / 17 docs; split 30 tune / 34 test. One query — index 31,
`"how to deploy this in AWS"`, kind `paraphrase`, **split `test`** — has `relevant: []`.

Guard behaviour in `harness.ts`:

- `recallAt` (204) and `ndcgAt` (225): `if (total === 0) continue` skips the numerator but the
  divisor stays `rankings.length`.
- `mrr` (215): **no guard at all** — contributes 0 to the numerator, 1 to the denominator.
- `precisionAt` (220): no guard, and divides by `k` rather than `min(k, total)`.

Ceilings on the 34-query test split, computed from label density:

| Metric | Attainable ceiling |
|---|---|
| MRR | 33/34 = **0.9706** |
| R@1 / R@3 / R@5 | **0.9706** |
| nDCG@5 | **0.9706** |
| P@3 | **0.3627** |

Against the published held-out table (`RESULTS.md:57-62`):

| Metric | semantic | hybrid | hybrid+rerank | ceiling | verdict |
|---|---|---|---|---|---|
| R@3 | 97% | 94% | 94% | 97.06% | semantic **at ceiling** |
| R@5 | 97% | 97% | 97% | 97.06% | **all three at ceiling** |
| P@3 | 36% | 35% | 35% | 36.27% | semantic **at ceiling** |
| nDCG@5 | 95% | 88% | 92% | 97.06% | near |

**Hypothesis confirmed, and it is worse than stated in the brief.** The published `R@5 = 97%` is
not a score of 97%; it is 100% of what is attainable. Three strategies are pinned to the ceiling at
k≥5 and the benchmark cannot separate them there at all. `P@3 = 36%` against a 36.27% ceiling is
likewise saturated, and reads as a poor score to anyone who does not know the denominator.

Not yet verified empirically — these are ceilings derived from labels, not from a run. Confirming
that the reported figures *are* the ceiling rather than coincidentally equal to it requires
re-running the harness (Phase 2).

### Instrument status

`recallAt`, `mrr`, `precisionAt`, `ndcgAt` are from-scratch and have **no tests**.
`apps/web/test/unit/` contains `acl`, `hybrid`, `ratelimit`, `rerank` — no `metrics.test.ts`.
CI runs `pnpm eval` as a gate (`ci.yml:180`), so these untested functions decide build outcomes.
Phase 1 is therefore blocking, as the brief requires.

### Conclusions carried into later phases

1. Depth asymmetry is real, and production/harness disagree — Phase 3 confirmed on inspection.
2. Gate leak is real, 4 of 6 rows — Phase 5 confirmed on inspection.
3. Ceiling saturation is real and binding at k≥3 — Phase 2 confirmed analytically.
4. One chunk per document makes this a 17-way document ranking task, which limits what any
   depth experiment can show. Phase 8 (corpus scale-up) is the true unblocker.
5. `DEFAULT_HYBRID_WEIGHT` (0.4) ≠ swept weight (0.55). Production and eval run different blends.
6. The provenance line "10 chunks per strategy" in captured results is false.

**Gate: reported to the user, awaiting confirmation before Phase 1.**

**Confirmed 2026-08-04.** Direction given: no local Docker; use cloud / GitHub Actions CI for
anything needing services. Local machine has no working C toolchain (Xcode CLT SDK path broken),
so `pytrec_eval` — a Cython extension — cannot build here. Consequence for Phase 1: **1b (synthetic
rankers, pure functions) runs locally; 1a (reference cross-check) runs in GitHub Actions**, whose
`eval` job already provisions pgvector + Elasticsearch and whose runners ship gcc and Python.

---

## 2026-08-04 — Phase 1: prove the metric code is correct

### Pre-registration (written BEFORE any implementation or run)

Derivations below are exact rationals computed from the test-split label density established in
Phase 0 (34 queries: 29 with one relevant doc, 4 with two, 1 with none) over a corpus of N = 17
single-chunk documents. Command: `python3` with `fractions.Fraction`, output pasted verbatim.

**Synthetic ranker expectations — asserted exactly (1b):**

| Ranker | Metric | Exact value | Decimal |
|---|---|---|---|
| Oracle | MRR | 33/34 | 0.9705882353 |
| Oracle | **R@1** | **31/34** | **0.9117647059** |
| Oracle | R@3 = R@5 | 33/34 | 0.9705882353 |
| Oracle | P@3 | 37/102 | 0.3627450980 |
| Oracle | nDCG@5 | 33/34 | 0.9705882353 |
| Reversed | MRR | 133/2312 | 0.0575259516 |
| Reversed | R@5, P@3, nDCG@5 | 0 | 0 |
| Random | MRR | 196825243/944239296 | 0.2084484768 |
| Random | R@1 | 33/578 | 0.0570934256 |
| Random | R@3 | 99/578 | 0.1712802768 |
| Random | R@5 | 165/578 | 0.2854671280 |
| Random | P@3 | 37/578 | 0.0640138408 |

Random expectations are closed-form, not simulated:
`E[R@k] = (judged/n)·(k/N)` since a uniform shuffle puts `k·t/N` relevant docs in the top k in
expectation; and `E[1/R_first] = Σ_r (1/r)·C(N−r, t−1)/C(N, t)`, since the number of ways to place
t relevant docs with the earliest at rank r is C(N−r, t−1). The 100-seed simulated mean is asserted
against these within tolerance; the closed forms themselves are asserted exactly.

**Prediction 1 — the one that matters.** Oracle R@1 is **0.9118, not 1.0**, and oracle MRR is
**0.9706, not 1.0**. If the implementation returns 1.0 for either, the metric is wrong. Two separate
causes are folded into that shortfall: the unanswerable query (33/34) and the four two-relevant
queries, which cap recall@1 at 1/2 each. This is the Phase 10 "R@1 naming" problem made numeric —
R@1 here is a recall, not a hit rate, and cannot reach 1.

**Prediction 2.** Oracle P@3 = 37/102 = 0.36275 is *identical* to the P@3 ceiling derived in
Phase 0. Reported semantic P@3 is 36%. So semantic is at or within rounding of a perfect score on
P@3, and the published table gives no way to see that.

**Prediction 3 — reference cross-check (1a).** `trec_eval`/`pytrec_eval` average only over queries
present in the qrels file, and a query with no relevant documents cannot appear there. The harness
averages over all 34. I therefore predict, **before running it**:

> `harness_value = (33/34) × pytrec_eval_value` for MRR (`recip_rank`), recall@{1,3,5}, P@3
> (`P_3`) and nDCG@5 (`ndcg_cut_5`) — agreement to 4dp after that single correction, and
> disagreement of exactly 1/34 ≈ 2.94% relative without it.

If the residual is anything other than that factor, the divergence is a genuine convention
mismatch (most likely in IDCG truncation) and the reference wins.

**Prediction 4.** nDCG@5 will agree once corrected for Prediction 3. The harness builds IDCG over
`min(k, total)` with binary gain 1/log2(j+1), which is the standard convention `ndcg_cut` uses.
Confidence here is lower than for the other metrics — nDCG has the most convention freedom, and
this is the one I most expect to be wrong.

### Deviation from the brief, and why

The brief specifies `eval/metrics.test.ts`. Placing it there would **not** put it in CI: `test:unit`
runs `vitest --dir test/unit` and `test:integration` runs `--dir test/integration`
(`apps/web/package.json:21-22`), so a file under `eval/` is collected by neither. The metric
functions are pure and I/O-free, which is exactly the repo's own stated criterion for the unit
suite (`vitest.config.ts` header comment). Placing the file at **`apps/web/test/unit/metrics.test.ts`**
satisfies the brief's actual requirement — "these tests go in CI" — with no config change, and runs
on every push in the existing `unit tests` job rather than only in the services-bound `eval` job.

### What was built

- `apps/web/eval/metrics.ts` — `recallAt`, `mrr`, `precisionAt`, `ndcgAt`, `ranksForQuery`,
  `dedupDocs` moved out of `harness.ts` **unchanged**, plus a new `ceilingFor` (used in Phase 2).
  No semantic change in this phase; the extraction exists so the instrument can be tested without
  Postgres or Elasticsearch.
- `apps/web/test/unit/metrics.test.ts` — 20 tests, synthetic rankers, exact expectations.
- `apps/web/eval/trec-export.ts` + `apps/web/eval/crosscheck.py` — TREC-format export and the
  `pytrec_eval` comparison.
- `.github/workflows/ci.yml` — new `metrics cross-check` job; `workflow_dispatch` added so eval
  jobs can be run on a branch without opening a PR.

### 1b result — synthetic rankers

`pnpm --filter @indexflow/web test:unit` → **53 passed (5 files)**, of which 20 are the new metrics
suite. Every pre-registered exact value was met at 12 decimal places on the first run; no
expectation was adjusted to match output.

Prediction 1 **confirmed**: oracle MRR = 0.9706 and oracle R@1 = 0.9118, both strictly below 1.0.
Prediction 2 **confirmed**: oracle P@3 = 37/102 = 0.362745, identical to the Phase 0 ceiling.

One test earns its place beyond the brief's list — `"would double-count without the dedup"` asserts
that an un-deduplicated ranking yields `recall@3 = 2.0`. A recall above 1.0 is the visible symptom
if `dedupDocs` is ever removed, and nothing else in the suite would catch it.

Also found, already known to the author: `test/unit/hybrid.test.ts` contains
`KNOWN WART: drops each leg's lowest hit, because min-max sends it to exactly 0`. The Phase 0 Q2
finding was documented in a test, not overlooked.

### 1a result — cross-check against pytrec_eval

Two CI failures before a green run, both environmental, neither a metric defect:

1. `pip install` and `python3` resolved different interpreters under pnpm. Fixed by installing with
   `python3 -m pip` and invoking the checker as a plain workflow step.
2. `pytrec_eval==0.5` builds a wheel on Python 3.12 but the extension does not import. Switched to
   `pytrec-eval-terrier` (same module name, maintained fork). My handler had swallowed the real
   exception, which cost the round trip; it now prints `repr(exc)`.

Green run: **[CI 30949539937](https://github.com/JCHETAN26/IndexFlow/actions/runs/30949539937)**,
all five jobs pass. Raw output, four rankers × six measures:

| ranker | measure | harness | reference | ref × 33/34 | delta |
|---|---|---|---|---|---|
| oracle | recip_rank | 0.970588 | 1.000000 | 0.970588 | 0.00e+00 |
| oracle | recall_1 | 0.911765 | 0.939394 | 0.911765 | −1.11e−16 |
| oracle | recall_3 | 0.970588 | 1.000000 | 0.970588 | 0.00e+00 |
| oracle | recall_5 | 0.970588 | 1.000000 | 0.970588 | 0.00e+00 |
| oracle | P_3 | 0.362745 | 0.373737 | 0.362745 | +1.11e−16 |
| oracle | ndcg_cut_5 | 0.970588 | 1.000000 | 0.970588 | 0.00e+00 |
| reversed | recip_rank | 0.057526 | 0.059269 | 0.057526 | +1.39e−17 |
| reversed | all cut-off metrics | 0.000000 | 0.000000 | 0.000000 | 0.00e+00 |
| random | recip_rank | 0.196606 | 0.202564 | 0.196606 | 0.00e+00 |
| random | recall_1 | 0.044118 | 0.045455 | 0.044118 | 0.00e+00 |
| random | recall_3 | 0.161765 | 0.166667 | 0.161765 | +2.78e−17 |
| random | recall_5 | 0.323529 | 0.333333 | 0.323529 | +5.55e−17 |
| random | P_3 | 0.068627 | 0.070707 | 0.068627 | 0.00e+00 |
| random | ndcg_cut_5 | 0.179691 | 0.185137 | 0.179691 | −2.78e−17 |
| scattered | recip_rank | 0.323529 | 0.333333 | 0.323529 | +1.11e−16 |
| scattered | recall_3 | 0.911765 | 0.939394 | 0.911765 | −1.11e−16 |
| scattered | recall_5 | 0.911765 | 0.939394 | 0.911765 | −1.11e−16 |
| scattered | P_3 | 0.323529 | 0.333333 | 0.323529 | +1.11e−16 |
| scattered | ndcg_cut_5 | 0.462538 | 0.476554 | 0.462538 | 0.00e+00 |

**Prediction 3 confirmed exactly.** Every measure agrees after multiplying the reference by
33/34; residuals are 1e−16 to 1e−17, i.e. floating-point representation error, twelve orders of
magnitude inside the 1e−4 tolerance.

**Prediction 4 confirmed.** nDCG@5 agrees. The harness's IDCG convention — binary gain, IDCG over
`min(k, total)` — is `ndcg_cut`'s convention. This was the one I expected to be wrong; it is not.

**Conclusion: the metric implementations are correct.** Nothing downstream is blocked. The only
divergence from the reference is the unanswerable query in the denominator, and the reference's
oracle values make that unambiguous — `trec_eval` scores the oracle at exactly **1.000000** where
the harness scores **0.970588**. That is not a metric bug; it is the Phase 2 finding, now measured
rather than argued: **0.9706 is the attainable ceiling, and three strategies are sitting on it.**

### Regression check on the extraction

The services-bound `eval` job in the same CI run passed and reproduced the captured numbers
exactly — keyword 0.73, semantic 0.94, hybrid 0.85, hybrid+rerank 0.90; R@5 97/97/97; sweep best
0.55; the same four reranker regressions. Moving the metric functions changed no output.

This is also an independent reproducibility result: `RESULTS.md` was captured 2026-07-28 on an 8 GB
Mac, and the run reproduces bit-for-bit on an `ubuntu-latest` runner. Recorded because it was not
previously known to be machine-independent.

Empirical confirmation of the Phase 0 arithmetic, from this run rather than from the label file:

| | semantic | hybrid | hybrid+rerank | ceiling |
|---|---|---|---|---|
| R@5 | 97% | 97% | 97% | **97.06%** |
| P@3 | 36% | 35% | 35% | **36.27%** |

**Gate: Phase 1 passed — nothing disagreed. Reported to the user.**

---

## 2026-08-04 — Phase 2: the ceiling problem

User confirmed the recommended convention: exclude unanswerable queries from the ranking metrics,
score rejection separately.

### Decision, and its justification

**Unanswerable queries are excluded from the denominator of MRR, recall@k, precision@k and
nDCG@k.** A query with no relevant document cannot be ranked well or badly — there is nothing to
place at rank 1 — so scoring it as a miss penalises a behaviour that is actually correct. This is
also precisely `trec_eval`'s convention, which means the Phase 1 cross-check gets *stronger*: the
expected harness/reference scale moves from 33/34 to exactly **1**, and `trec-export.ts` now
asserts that.

Rejection is measured separately, but **not as a rate**, for two reasons discovered while
implementing it:

1. **There is one unanswerable query in the held-out split and none in the tuning split.** A rate
   over n=1 measures nothing, and any threshold calibrated to separate that single query would be
   fitted to the test set — exactly the failure this project already retired once.
2. **The hybrid strategy cannot be given a rejection score at all.** `blendHybrid` min-max
   normalises per query, so the top blended score is 1.0 for *every* query regardless of whether
   anything relevant was found. Only raw leg scores carry absolute information, and of those only
   cosine is comparable across queries — BM25's scale moves with the query's term IDFs.

So the report prints *separation*: the top raw score on the unanswerable query beside the min /
median / max of top raw scores on answerable ones, per leg, with a `separable` verdict. If the
unanswerable query's score falls inside the answerable range, no threshold could tell them apart.
That is a descriptive finding, honestly bounded, rather than a fabricated rate.

### Pre-registration (written BEFORE the re-run)

Numerators are unchanged and the denominator drops 34 → 33, so **every held-out ranking metric
should rise by exactly 34/33 = 1.0303**, subject to rounding at the printed precision.

| metric | before | predicted after |
|---|---|---|
| semantic MRR | 0.94 | 0.97 |
| hybrid MRR | 0.85 | 0.88 |
| hybrid+rerank MRR | 0.90 | 0.93 |
| keyword MRR | 0.73 | 0.75 |
| semantic / hybrid / +rerank R@5 | 97% | **100%** |
| semantic R@1 | 85% | 88% |
| semantic P@3 | 36% | 37% |

**The load-bearing prediction: R@5 becomes exactly 100% for three strategies, and the new ceiling
row prints 100% beside it.** If R@5 lands below 100% then those strategies were *not* at the
ceiling and the Phase 0 arithmetic was wrong about which queries they were missing.

Secondary predictions:

- `byKind` is computed on the whole set (tune + test), and the single unanswerable query is a
  *paraphrase*. So paraphrase metrics should rise slightly and **exact metrics should not move at
  all**. Any movement in an exact-query number means something other than this change moved.
- No gate row should fail; every floor sits below a number that is going up.
- The weight sweep runs on the tuning split, which contains no unanswerable query, so **the
  selected weight should stay 0.55**. If it moves, the sweep is more fragile than believed.

### Implementation

- `metrics.ts` — all four metrics divide by `judgedCount(evals)`; `mrr` and `precisionAt` now take
  the label rows (they previously could not tell which queries were judged). Added `ceilingFor`,
  `fractionOfCeiling`, `rejectionSignal`.
- `harness.ts` — `ceilings` and `rejection` blocks on the report; bootstrap resamples judged
  queries only, so the interval surrounds the same quantity the point estimate reports;
  `dataset.numTestJudged` records the real denominator.
- `run.ts` — permanent `ceiling` row in the strategy table, a `% of attainable ceiling` table
  beneath it, and a rejection block.
- Unit expectations re-derived and re-registered above; 54 tests pass locally.

