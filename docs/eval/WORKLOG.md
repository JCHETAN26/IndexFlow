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

### Result — before and after

Run: [CI 30951555564](https://github.com/JCHETAN26/IndexFlow/actions/runs/30951555564), `eval` job,
`ubuntu-latest`, same dataset fingerprints (queries `787aeddbf260`, corpus `29789f602b8a`).

```
Strategy          MRR   R@1   R@3   R@5   P@3   nDCG@5
keyword          0.75    62%    79%    82%    29%    74%
semantic         0.97    88%   100%   100%    37%    98%
hybrid           0.88    73%    97%   100%    36%    91%
hybrid+rerank    0.93    83%    97%   100%    36%    95%
ceiling          1.00    94%   100%   100%    37%   100%
────────────────────────────────────────────────────────
as % of attainable ceiling:
keyword          75%    66%    79%    82%    78%    74%
semantic         97%    94%   100%   100%   100%    98%
hybrid           88%    77%    97%   100%    97%    91%
hybrid+rerank    93%    89%    97%   100%    97%    95%
```

**Every pre-registered prediction confirmed, including the load-bearing one.** R@5 is exactly
**100%** for semantic, hybrid and hybrid+rerank — so the Phase 0 arithmetic was right about which
queries those strategies were missing, namely none. Metric-by-metric the shift is exactly 34/33.

Secondary predictions, all confirmed:

- Exact-query numbers did not move: 92%/0.98, 86%/0.94, 95%/1.00, 92%/0.98 — byte-identical to the
  pre-change run, as required, since the unanswerable query is a paraphrase.
- Paraphrase numbers rose: semantic 84%/0.92 → 87%/0.95, hybrid 69%/0.83 → 71%/0.85.
- The sweep selected 0.55 again, with an identical sweep curve.
- No gate row failed.

### What the ceiling row exposes

The `% of attainable ceiling` table makes the saturation impossible to miss, and it is worse than
the raw numbers suggested:

- **Semantic is at 100% of ceiling on R@3, R@5 *and* P@3** — three of six metrics maxed out.
- **All three non-keyword strategies are at 100% of ceiling on R@5.** The benchmark cannot
  distinguish them at k≥5 at all; the metric has no remaining resolution.
- The bootstrap interval for hybrid R@5 is now **[100%–100%]** — zero width. A degenerate
  confidence interval is the clearest possible signal that a measurement has stopped measuring.
- P@3 = 37% now reads correctly as **100% of ceiling** rather than as a poor precision. Before this
  change a reader had to derive the 37% cap from the label file to interpret the number at all.

Keyword is the only strategy with real headroom left (66–82% of ceiling), which is precisely why it
is the least interesting configuration to keep tuning.

### Rejection — a genuine finding, on n=1

```
keyword   unanswerable top 2.882   answerable top min 0.053 / med 5.193 / max 11.338   NOT separable
semantic  unanswerable top 0.094   answerable top min 0.196 / med 0.477 / max 0.723   separable
hybrid    not measurable — min-max normalisation puts every query's top at 1.000
```

**The semantic leg carries a usable abstention signal and the blend destroys it.** Cosine on the
unanswerable query is 0.094, below the *minimum* over all 33 answerable queries (0.196); any
threshold in that gap would abstain correctly and accept everything else. BM25 cannot do this — its
unanswerable score of 2.882 sits above the answerable minimum of 0.053, inside the range, because
BM25's scale moves with query IDF and is not comparable across queries. And hybrid cannot be asked
the question at all, because normalisation discards the absolute magnitude that carries the signal.

This connects directly to the Phase 3 hypothesis: min-max normalisation is not merely reshaping
scores, it is destroying information the semantic leg had. Filed as a Phase 3/4 input.

**Weight of evidence: n = 1.** One unanswerable query cannot establish a rejection rate, and
threshold calibration is impossible with zero unanswerable queries in the tuning split. The right
fix is label work — unanswerable queries in *both* splits — which belongs with Phase 8.

### Cross-check after the change

[CI 30963101701](https://github.com/JCHETAN26/IndexFlow/actions/runs/30963101701) — green, with
**declared scale 1.000000 and no correction applied**. Harness and `pytrec_eval` now agree
exactly, residuals 0 to 1.67e−16. The harness's treatment of unanswerable queries is now the
reference convention rather than merely a documented deviation from it.

One self-inflicted failure first: `crosscheck.py` recomputed `scale = judged/total` locally instead
of reading the declared `predictedScale`, so it re-applied the retired correction and reported
MISMATCH on 18 rows whose harness and reference columns were *identical*. The output made this
obvious — the two value columns matched and only the derived column differed. Fixed by reading the
declared scale.

### Not done in this phase

`RESULTS.md` and `README.md` still carry the pre-Phase-2 numbers. Deliberate: Phase 3 changes
retrieval depth, which will move them again, and rewriting the canonical results file twice would
put two supersession notices in it for one week of work. The numbers above are recorded here with
their run link in the meantime.

**Gate: Phase 2 complete, all predictions confirmed. Reported to the user.**

---

## 2026-08-05 — Phase 3: retrieval depth asymmetry

### Hypothesis, restated against the code

Confirmed by inspection in Phase 0: the harness retrieves keyword at `chunks.length` and semantic
at `LIMIT 10`, while production retrieves both at `CANDIDATE_LIMIT = 30`.

**What the brief could not know, and what changes the shape of this phase:** the corpus is 17
documents of 37–54 words each against `TARGET_WORDS = 180`, so there are exactly **17 chunks**.
Therefore:

- `chunks.length` = 17. The keyword leg's depth is 17, not "thousands".
- Depth cells **50/50, 100/100 and all/all are all identical to 17/17** on this corpus. The
  requested 4-cell matrix collapses to **three distinct configurations**: 10/10, 17/17, and the
  current 17/10.
- **Production's 30/30 is also 17/17 here.** So the production configuration is not merely
  different from the harness — it is exactly the equal-depth cell the brief hypothesises about.
  Every published retrieval number measures 17/10, a configuration that has never shipped.

I will still run the full requested matrix and report the collapse explicitly rather than silently
dropping cells.

### Pre-registration (written BEFORE any depth code exists)

**Mechanism I expect to dominate.** `normalize()` in `lib/hybrid.ts` is min-max per leg, so a
deeper list has a lower minimum, which *compresses the top of that list toward 1.0*. Concretely,
for scores max=10, x₂=9: at min=5 the second item normalises to 0.80; at min=0 it normalises to
0.90. Depth therefore does not just add candidates, it flattens the leg's discrimination near the
top. A leg retrieved deep is a leg that votes less decisively among its own best hits.

**Prediction 1 — the headline.** Equal depth will **not** materially rescue hybrid. Held-out hybrid
MRR is 0.88 against semantic's 0.97; I predict equal depth moves hybrid by **less than 0.05** and
that it **remains below semantic**. The published conclusion that blending hurts on this corpus
survives Phase 3. Stated plainly so it cannot be reinterpreted afterwards: if hybrid at 17/17
reaches 0.97 or above, **I was wrong and the conclusion was confounded**.

**Prediction 2 — paraphrase specifically.** The brief expects the paraphrase deficit to be the
thing depth repairs. I predict it **barely moves (<0.03)**, and my reasoning is the post-Phase-2
number: semantic alone scores paraphrase MRR **0.95**, meaning it already places relevant documents
at or near rank 1 on paraphrases. Very few relevant documents can be sitting at semantic ranks
11–17 where the `LIMIT 10` truncation actually bites. The truncation is real but it is mostly
truncating documents that were never going to matter.

**Prediction 3 — direction of 10/10 versus 17/10.** Truncating the *keyword* leg to 10 should
**slightly improve** hybrid. At depth 17 the keyword leg injects every matching chunk into the
union, each with a nonzero normalised score, so BM25's tail gets a vote on queries where it has no
signal. Cutting that tail should remove noise more than it removes information.

**Prediction 4 — the weight will move.** The optimal blend weight is currently 0.55 on a 17/10
configuration. Since equal depth changes the relative spread of the two legs, I expect the selected
weight to **shift toward semantic (i.e. below 0.55)** at 17/17. Low confidence; the sweep plateau
is wide and flat (0.30–0.80 all score 0.98), so the tie-break may simply re-select the middle.

**Prediction 5 — rejection separation is unaffected.** The semantic abstention signal found in
Phase 2 lives in *raw* cosine, before normalisation, so no depth change should alter it.

### Method

Retrieving at depth k returns exactly the first k of a full-depth ranked list, for both legs — ES
returns BM25's top-k by score and the SQL leg is `ORDER BY ... LIMIT k`. So one retrieval pass at
full depth supports every cell by truncation, with no loss of fidelity. This avoids re-seeding and
re-embedding per cell, and avoids the reranker entirely, which the depth question does not involve.

Matrix runs on the **tuning split only**. The depth configuration is chosen there, then held-out
numbers are produced **once**.

### Result — the matrix

Run: [CI 30963724884](https://github.com/JCHETAN26/IndexFlow/actions/runs/30963724884), `eval` job.
Tuning split, 30 queries (17 exact / 13 paraphrase).

```
cell                        effective   weight   MRR     exact   para    R@1    R@5    nDCG@5
10 / 10                     10/10       0.55     0.98    1.00    0.96     95%   100%    99%
50 / 50                     17/17       0.45     0.98    1.00    0.96     95%   100%    99%
100 / 100                   17/17       0.45     0.98    1.00    0.96     95%   100%    99%
all / 10 (legacy)           17/10       0.55     0.98    1.00    0.96     95%   100%    99%
30 / 30 (production)        17/17       0.45     0.98    1.00    0.96     95%   100%    99%
```

**Every cell is identical on every metric.** Only the selected weight moves (0.55 → 0.45). As
predicted, 50/50, 100/100 and 30/30 all collapse to 17/17.

The reason no cell differs is not that depth is harmless — it is that **the tuning split is itself
saturated**: MRR 0.98, exact 1.00, R@5 100%. There is no headroom in which a depth effect could
become visible. This experiment cannot answer the question it was designed to answer, and the
corpus is why.

### Result — the mechanism is real, the effect is not

The normalisation diagnostic isolates the compression mechanism directly, reporting the mean
normalised score of each leg's *second*-ranked hit:

```
depth 10 / 10    keyword 0.401   semantic 0.565
depth 17 / 17    keyword 0.405   semantic 0.659
```

**Semantic's runner-up rises from 0.565 to 0.659 as depth grows** — the predicted compression
toward 1.0, measured. A deeper semantic leg genuinely does vote less decisively among its own best
hits. Keyword barely moves (0.401 → 0.405) because most queries match fewer than 10 chunks, so
truncating at 10 rarely binds.

So the mechanism I pre-registered is confirmed to exist, and confirmed **not** to matter at this
corpus size. Both halves are findings.

### Result — held-out, scored once at production depth

Depth chosen on the grounds that the tuning split could not discriminate: **mirror production**.
Measuring a configuration that has never shipped is indefensible regardless of how it scores.

| metric | legacy 17/10, w=0.55 | production 17/17, w=0.45 | Δ |
|---|---|---|---|
| hybrid MRR | 0.88 | **0.89** | +0.01 |
| hybrid R@1 | 73% | **76%** | +3pp |
| hybrid paraphrase MRR | 0.85 | **0.87** | +0.02 |
| hybrid R@5 | 100% | 100% | — |
| semantic MRR | 0.97 | 0.97 | — |
| keyword MRR | 0.75 | 0.75 | — |
| hybrid+rerank MRR | 0.93 | 0.93 | — |

Quality gate: all six rows pass.

### Predictions, scored honestly

| # | Prediction | Outcome |
|---|---|---|
| 1 | Equal depth moves hybrid <0.05 and it stays below semantic | **Confirmed.** +0.01; 0.89 vs semantic 0.97 |
| 2 | Paraphrase moves <0.03 | **Confirmed.** +0.02 (0.85 → 0.87) |
| 3 | Truncating keyword to 10 slightly improves hybrid | **Wrong — and unmeasurable.** 10/10 scored identically to 17/10 on a saturated tuning split. I predicted a direction for an effect the instrument could not resolve |
| 4 | Weight shifts below 0.55 at equal depth | **Confirmed.** 0.55 → 0.45 |
| 5 | Rejection separation unaffected | **Confirmed.** Identical (0.094 vs answerable min 0.196) |

**The brief's two outcomes, resolved: the second one.** Hybrid did not improve materially at equal
depth, so a fourth alternative explanation for the "blending hurts" finding is ruled out and the
original conclusion is *stronger*, not weaker. It now rests on a harness that measures the shipped
configuration. Recording the caveat that makes this weaker than it sounds: the tuning split could
not have shown the opposite, so this rules out the confound only to the extent the held-out split
has resolution, and at R@5 it has none.

### Two things found along the way

**The two splits disagree about which strategy is better.** On the tuning split, keyword MRR
**0.96** beats semantic **0.92**. On the held-out split, semantic **0.97** beats keyword **0.75** —
a complete reversal. This follows from composition: tuning is 17 exact / 13 paraphrase, held-out is
15 exact / 19 paraphrase, and the kinds favour opposite legs. The balanced-MRR selection criterion
was introduced to stop pooled MRR letting the larger kind pick the weight, and it is doing its job,
but **the blend weight is still being selected on a split whose character is the inverse of the one
it is scored on.** That is a live threat to the weight's validity and is not currently disclosed
anywhere. Filed for Phase 6/8 — the fix is stratified splits, not a criterion change.

**`DEFAULT_HYBRID_WEIGHT` fixed.** It read 0.4 while the sweep selected 0.55, so production served
a blend no published number described — found in the review that preceded this work. Now set to
**0.45**, the weight selected on the tuning split at production depth. The plateau is wide and flat
(0.20–0.70 all at 0.98), so this is a plateau centre rather than a sharp optimum, and the comment
in `lib/hybrid.ts` now records the full drift history so the next divergence is visible.

**Gate: Phase 3 complete. Reported to the user.**

---

## 2026-08-05 — Phases 4 and 5

Run together: both change `harness.ts`, and one CI run covers both. Ordering agreed with the user —
Phase 4 and 5 are cheap and unblocked, then Phase 8 (corpus scale-up) ahead of Phases 6 and 7,
since label validation and BEIR anchoring are both far more valuable against 500 documents than 17.

### Phase 4 — the hypothesis being tested is the wrong one

`bootstrapCI` produces **marginal** intervals, for hybrid only, and `RESULTS.md` reads their width
as evidence that the semantic/hybrid gap is not a ranking:

> "intervals this wide on a set this size mean small gaps are not rankings"

**That inference is invalid.** Overlapping marginal intervals do not imply an insignificant
difference. Both strategies are scored on the *same* queries, so the comparison is paired, and the
paired test can resolve a difference that marginal intervals cannot — the per-query correlation is
exactly the variance the paired difference removes.

The direction of the error matters: the current framing is conservative, so the repo may be
**understating** its most interesting result.

### Phase 4 pre-registration

Held-out MRR at production depth: keyword 0.75, semantic 0.97, hybrid 0.89, hybrid+rerank 0.93.
Paired bootstrap over 33 judged queries, 2000 resamples, same deterministic seed.

| pair | Δ MRR | prediction |
|---|---|---|
| semantic − keyword | +0.22 | excludes zero — **high confidence** |
| semantic − hybrid | +0.08 | **excludes zero** — the load-bearing call |
| hybrid+rerank − keyword | +0.18 | excludes zero |
| hybrid − keyword | +0.14 | excludes zero |
| semantic − hybrid+rerank | +0.04 | **does not** exclude zero |
| hybrid+rerank − hybrid | +0.04 | genuinely uncertain; I lean "excludes zero", low confidence |

**The load-bearing prediction: semantic − hybrid excludes zero.** If it does, then "blending a weak
keyword leg into a strong semantic one measurably hurts retrieval" is a *statistically supported
negative finding*, and the sentence in `RESULTS.md` calling it noise is wrong in the repo's own
disfavour. If the interval includes zero, the current cautious framing was right and I say so.

Secondary: marginal intervals for all four strategies will be **wide enough to overlap** between
semantic and hybrid even where the paired interval excludes zero. That contrast is the entire point
of the phase, and I expect to be able to show it in one table.

### Phase 5 pre-registration

`byKind` is computed from `evals` (tune + test), so four of six gate rows include the 30 queries
that selected the blend weight. Pointing them at held-out rows only.

The two splits differ sharply in character (Phase 3 finding: tuning favours keyword, held-out
favours semantic), so removing the tuning queries should move keyword-flattering rows **down**.

| gate row | floor | current (whole set) | predicted (held-out) |
|---|---|---|---|
| keyword R@1 on exact | 50% | 92% | drops to ~85–90%, passes |
| semantic R@1 on paraphrase | 70% | 87% | ~85–90%, passes |
| hybrid best on exact queries | 85% | 95% | **~87–93% — closest to its floor, the one at risk** |
| hybrid does not collapse on paraphrase | 75% | 0.87 | ~0.85, passes |

Prediction: **all six still pass**, with "hybrid best on exact queries" the narrowest margin. If any
floor fails I will report it and not touch the floor.

### Phase 4 result

Run: [CI 30964731360](https://github.com/JCHETAN26/IndexFlow/actions/runs/30964731360), all jobs green.

```
95% MARGINAL bootstrap intervals (held-out):
  keyword         MRR 75% [62%–87%]      R@1 62% [45%–77%]      R@5 82% [67%–94%]
  semantic        MRR 97% [92%–100%]     R@1 88% [77%–97%]      R@5 100% [100%–100%]
  hybrid          MRR 89% [81%–96%]      R@1 76% [62%–88%]      R@5 100% [100%–100%]
  hybrid+rerank   MRR 93% [85%–98%]      R@1 83% [70%–94%]      R@5 100% [100%–100%]

95% PAIRED bootstrap on the per-query MRR difference (held-out):
  Δ MRR semantic − keyword          +0.22 [ 0.11, 0.35]   excludes zero: yes   SIGNIFICANT
  Δ MRR hybrid+rerank − keyword     +0.18 [ 0.08, 0.28]   excludes zero: yes   SIGNIFICANT
  Δ MRR hybrid − keyword            +0.14 [ 0.07, 0.23]   excludes zero: yes   SIGNIFICANT
  Δ MRR semantic − hybrid           +0.08 [ 0.01, 0.16]   excludes zero: yes   SIGNIFICANT
  Δ MRR semantic − hybrid+rerank    +0.04 [-0.03, 0.13]   excludes zero: no    not significant
  Δ MRR hybrid+rerank − hybrid      +0.03 [-0.03, 0.10]   excludes zero: no    not significant
```

**The load-bearing prediction is confirmed, and the contrast is visible in one screen.** Semantic's
marginal interval [92%–100%] overlaps hybrid's [81%–96%] — by the repo's current reasoning that
gap is "not a ranking". The paired interval on the same data is **+0.08 [0.01, 0.16] and excludes
zero.** The overlap was an artifact of discarding the pairing, exactly as pre-registered.

So: **"blending a weak keyword leg into a strong semantic one measurably hurts retrieval on this
corpus" is a statistically supported negative finding**, not noise. `RESULTS.md` currently says the
opposite about its own result, and is wrong in its own disfavour.

Predictions scored: **five of six correct**, three of them to the exact hundredth (+0.22, +0.08,
+0.18, +0.14 all as predicted). The miss is `hybrid+rerank − hybrid`, where I leaned "excludes
zero" and it does not — I had flagged that one as low confidence, which is the only reason the miss
is not worse.

**A finding that cuts against the repo, recorded because it hurts.** `hybrid+rerank − hybrid` is
**+0.03 [−0.03, 0.10], not significant.** The README presents reranking as a demonstrated
improvement ("It now scores MRR 0.90, above plain hybrid's 0.85"). At n=33 that improvement is not
distinguishable from zero. The reranker may well help — the point estimate is positive at every
depth tested — but the evidence currently on record does not support stating it as a result.
Likewise `semantic − hybrid+rerank` is not significant, so reranked hybrid and semantic-alone are
statistically indistinguishable here.

### Phase 5 result

| gate row | floor | whole set (before) | held-out (after) | margin | verdict |
|---|---|---|---|---|---|
| keyword R@1 on exact | 50% | 92% | **87%** | +37pp | PASS |
| semantic R@1 on paraphrase | 70% | 87% | **83%** | +13pp | PASS |
| semantic MRR overall | 85% | 97% | 97% | +12pp | PASS (already held-out) |
| hybrid R@5 overall | 90% | 100% | 100% | +10pp | PASS (already held-out) |
| hybrid best on exact queries | 85% | 95% | **93%** | +8pp | PASS |
| hybrid does not collapse on paraphrase | 75% | 0.87 | **0.80** | +5pp | PASS |

**All six pass, as predicted.** Every leaked row moved *down* when the tuning queries were removed,
in the direction Phase 3 anticipated from the split-composition difference.

I called the wrong row as most at risk: I predicted "hybrid best on exact queries", but the
narrowest margin is **"hybrid does not collapse on paraphrase" at 0.80 against a 0.75 floor** — a
5-point margin, and it fell 7 points when the leak was closed. That row is now one bad paraphrase
query away from failing CI.

**The material finding is what the leak was concealing.** On held-out exact queries:

```
            keyword        semantic       hybrid         hybrid+rerank
exact       87% / 0.97     93% / 1.00     93% / 1.00     93% / 1.00     ← held-out
exact       92% / 0.98     86% / 0.94     95% / 1.00     92% / 0.98     ← whole set
```

On the whole set hybrid looks uniquely strong on exact queries (95%/1.00 against semantic's
86%/0.94), and that is the basis of the claim in `RESULTS.md` that "hybrid is the best
configuration for exact-match queries" — the property that replaced the retired
"hybrid beats everything" gate. **On held-out data it is a three-way tie: semantic, hybrid and
hybrid+rerank all score R@1 93% and MRR 1.00.** Hybrid is not the best configuration for exact
queries; it is tied, and the apparent advantage came from the 30 tuning queries that selected its
blend weight.

The gate row `hybrid best on exact queries` therefore no longer tests what its name claims. It
still passes, but it is now asserting a property hybrid shares with two other strategies. Flagged
rather than changed — renaming or re-specifying a gate is a decision for the user.

**Gate: Phases 4 and 5 complete, all six floors pass. Reported to the user.**

---

## 2026-08-05 — Phase 8: corpus scale-up

User confirmed: proceed with Phase 8. Phase 7 stays deferred, though the corpus choice below
delivers most of it as a by-product.

### Corpus choice

The brief prefers "a public corpus with existing relevance judgements" over synthesised queries.
Taking that, and taking **both** of Phase 7's named datasets, because they fail in opposite
directions and the pair covers what neither does alone. Measured from the actual downloads, not
from documentation:

| | SciFact | NFCorpus |
|---|---|---|
| documents | **5,183** | 3,633 |
| test queries | **300** | 323 |
| train queries | 809 | — |
| judgments (test) | 339 | **12,334** |
| relevant per query | 1.13 (277 have exactly 1) | **~38** |
| relevance | binary (all 1) | **graded (1 and 2)** |
| mean doc length | 214 words | — |
| estimated chunks @ stride 150 | **8,778** | — |

Both clear the brief's bar (≥500 docs, ≥150 queries) on their own. Why both:

- **SciFact matches IndexFlow's task shape.** Sparse labels, usually one correct document — the
  same "find the right doc" problem the in-domain set poses, at 305× the corpus size.
- **NFCorpus fixes what SciFact does not.** Graded relevance and ~38 relevant documents per query
  make nDCG carry information that MRR does not, which is exactly the gap flagged in the original
  review (§3.5: "no NDCG, and the current label design cannot support it"). It also makes P@k
  meaningful, since its ceiling is no longer ~1/k, and makes R@5 saturation impossible.

**Domain caveat, recorded up front.** IndexFlow is permission-aware *workspace* search over
internal technical documents. SciFact is scientific claim verification and NFCorpus is nutrition
literature. Neither is in-domain. They measure whether the retrieval stack is competitive against
public baselines — real and currently unproven — not whether it is good at the product's actual
task. The existing 64-query in-domain set is therefore **preserved as the regression suite** and
remains what the CI gate scores, exactly as the brief requires.

**A limitation Phase 8 does not remove:** SciFact's relevance is binary, so on SciFact alone nDCG
still carries no information beyond MRR. Only NFCorpus fixes that, and only once the metric code
supports graded gain — currently `relevant: string[]` is a set, with no gain values. That is real
work, and until it lands NFCorpus numbers would be wrong rather than merely limited.

### Plan, and why it is staged

1. Dataset abstraction + BEIR loader, downloaded in CI with a pinned SHA256.
2. Scale run on **SciFact** (binary — works with today's metric code).
3. Graded-gain support, then **NFCorpus**.

Staged because step 2 is the feasibility question and step 3 is a metric-semantics change; running
them together would confound a scaling result with a scoring change.

The in-domain harness is left untouched. It keeps the gate honest while this is built, and the
brief requires preserving it anyway.

### Engineering risks identified before writing code

- **Seeding.** The harness inserts one row per `$executeRaw` inside a transaction with a 60 s
  timeout. At 5,183 documents + ~8,778 chunks that is ~14k round trips and will time out. Needs
  batched multi-row inserts and a much larger timeout.
- **Reranking.** The harness reranks the top 10 for *every* query. At 1,109 queries that is ~11k
  cross-encoder pairs on a CI CPU — plausibly 10–35 minutes, dominating the run. Reranking will be
  opt-in at scale, and its absence stated rather than quietly skipped.
- **Exact KNN.** Index scans are disabled so semantic ranking is brute force. Over ~8,778 chunks
  that is ~3.4M float ops per query; the cost is row-scan overhead, estimated tens of milliseconds
  per query, so ~1,109 queries should be seconds to a minute. Expected to be fine — recorded so
  that if it is not, the estimate is on the record as wrong.

### Pre-registration

**Prediction 1 — the point of the whole phase.** Metrics will drop sharply. On the 17-document
corpus semantic scores MRR 0.97 with R@5 at 100% of ceiling. On SciFact I predict semantic
**MRR 0.55–0.70** and **R@5 well below 90%**, i.e. no longer at ceiling. A drop is success here; a
number that stays near 0.95 would mean the harness is not really searching 5,183 documents.

**Prediction 2 — external anchor.** Published BM25 on SciFact is widely cited at **nDCG@10 ≈
0.665** (Thakur et al. 2021, BEIR). I predict **our BM25 underperforms it, landing 0.50–0.62**, for
three specific reasons: we chunk abstracts into ~1.7 pieces and score at document level after
dedup; we use Elasticsearch's default BM25 parameters rather than BEIR's tuned k1=0.9/b=0.4; and
our query is a `multi_match` with a `title^2` boost, not standard BM25 over concatenated
title+text. If the gap is larger than ~0.15 I will treat it as a defect to investigate, not a
configuration difference to explain away.

**Prediction 3.** Semantic will beat keyword on SciFact, consistent with the in-domain finding, and
the paired bootstrap will show it excluding zero given n=300 — a far larger sample than 33.

**Prediction 4.** Hybrid will land between the two and, unlike on the in-domain corpus, may
genuinely beat both: the in-domain result was driven by a weak keyword leg, and BM25 is much
stronger on SciFact. **This is the prediction most likely to overturn an existing conclusion**, and
I am explicitly stating it before seeing any number, so that "blending hurts" cannot be quietly
retained if the larger corpus contradicts it.

**Prediction 5.** Ceilings will be near 1.0 for MRR/R@k on SciFact (277 of 300 queries have exactly
one relevant document, so R@1's ceiling is ~0.96), and P@3's ceiling will remain low (~0.38) for
the same label-density reason as the in-domain set.

### A latent production bug, found by trying to scale

First attempt died at 60 seconds with `SIGTERM` from the runner. Cause: `lib/embed.ts` passed
**every** text to the extractor in one call, and transformers.js pads a batch to its longest
sequence and allocates a single tensor for it — 11,562 chunks × ~256 tokens × 384 floats ≈ **4.5 GB**.
The OS killed it.

This was **not only an eval bug**. The ingestion worker calls `embed()` with every chunk of an
uploaded document, so a large enough upload would have hit the same wall in production. Fixed by
batching at 64 inside `embed()`, where the memory characteristics are actually known, rather than
at each call site. Recorded here because it is the kind of defect that only a scale-up finds, and
it was invisible on a 17-chunk corpus.

### Result — SciFact, 5,183 documents, 300 held-out queries

Run: [CI 30978548207](https://github.com/JCHETAN26/IndexFlow/actions/runs/30978548207), 815 s wall
(751 s of it embedding). Dataset `beir-scifact-2021`, docs `e677ae667a9b`, queries `4cd6f5fef66d`.

```
Strategy         MRR    R@1     R@5     R@10    P@3     nDCG@10
keyword        0.62    50.8%   71.3%   76.2%   23.7%   64.6%
semantic       0.61    49.4%   71.4%   79.8%   23.0%   64.8%
hybrid         0.68    56.4%   77.7%   83.1%   25.2%   70.7%
ceiling        1.00    95.5%  100.0%  100.0%   36.9%  100.0%

95% paired bootstrap on per-query MRR difference:
  Δ keyword − semantic    +0.015 [-0.024, 0.052]   excludes zero: no    not significant
  Δ hybrid  − keyword     +0.056 [ 0.033, 0.081]   excludes zero: yes   SIGNIFICANT
  Δ hybrid  − semantic    +0.071 [ 0.043, 0.099]   excludes zero: yes   SIGNIFICANT
```

### THE HEADLINE: "blending hurts" does not generalise, and reverses

**On SciFact, hybrid significantly beats both single strategies** — +0.056 over keyword and +0.071
over semantic, both intervals excluding zero at n=300, a sample ten times larger than the in-domain
held-out split. This is the direct opposite of the in-domain finding, where semantic beat hybrid by
+0.08 with the interval excluding zero.

Both results are correct. They are not in conflict once the mechanism is stated:

| | in-domain (17 docs) | SciFact (5,183 docs) |
|---|---|---|
| keyword MRR | 0.75 | 0.62 |
| semantic MRR | 0.97 | 0.61 |
| legs comparable? | **no — semantic dominates by 0.22** | **yes — 0.015 apart, not significant** |
| hybrid vs best leg | **−0.08, significantly worse** | **+0.056, significantly better** |

**Blending helps when the two legs are comparably strong and complementary, and hurts when one leg
is much weaker than the other.** On the in-domain corpus a weak keyword leg is being averaged into
a near-perfect semantic leg, and that can only drag it down. On SciFact the legs are statistically
tied and evidently disagree in useful ways, so the blend captures what each misses.

This is a better finding than either component. It also means **the existing `RESULTS.md` claim is
over-generalised**: "hybrid does not beat both single strategies" is true of that corpus, not of
this system. I pre-registered this as the prediction most likely to overturn an existing
conclusion, precisely so it could not be quietly retained. It was overturned.

### External anchor — I was wrong, in the system's favour

| metric | ours | published | delta |
|---|---|---|---|
| BM25 nDCG@10 | **0.646** | ≈0.665 (BEIR, Thakur et al. 2021) | **−0.019** |
| all-MiniLM-L6-v2 nDCG@10 | **0.648** | ≈0.645 (sentence-transformers) | **+0.003** |

**Prediction 2 was wrong.** I predicted our BM25 would land 0.50–0.62 and underperform by up to
0.15, reasoning from three real differences: chunking abstracts into 2.23 pieces and scoring at
document level after dedup, Elasticsearch's default BM25 parameters rather than BEIR's tuned
k1=0.9/b=0.4, and a `multi_match` with `title^2` rather than plain BM25 over concatenated fields.
Those differences are real; together they cost about **two nDCG points, not fifteen**.

This is the strongest validity result in the project so far. **The whole pipeline — chunking,
Elasticsearch indexing and analysis, embedding, scoring, metric computation, document-level
deduplication — reproduces published literature numbers on a public corpus.** The dense-retrieval
leg matches its published figure to within 0.003. Whatever else is uncertain here, the machinery
is not silently broken.

### Predictions scored

| # | Prediction | Outcome |
|---|---|---|
| 1 | Metrics drop sharply; semantic MRR 0.55–0.70, R@5 well under 90% | **Confirmed.** 0.61 and 71.4% |
| 2 | Our BM25 lands 0.50–0.62, under published 0.665 | **Wrong.** 0.646 — a 0.02 gap, not 0.15 |
| 3 | Semantic beats keyword significantly | **Wrong.** Keyword +0.015, not significant — they are tied |
| 4 | Hybrid may beat both | **Confirmed, and it is the headline.** Both deltas significant |
| 5 | R@1 ceiling ≈0.96, P@3 ceiling ≈0.38 | **Confirmed.** 95.5% and 36.9% |

Three of five. The two misses are both about the *relative strength of the keyword leg*, which I
systematically underestimated — I expected Elasticsearch BM25 to be a weak baseline and it is not.
That single error explains both wrong predictions, and it is worth recording as a bias rather than
two separate mistakes.

### Saturation: gone

Every metric now has real headroom. R@5 is 71–78% against a 100% ceiling, R@10 is 76–83%, nDCG@10
is 65–71%. The benchmark can once again distinguish configurations — the weight sweep has a genuine
peak (0.61 at w=0.00, rising to 0.68 at 0.50, falling to 0.62 at 1.00) instead of the flat
0.20–0.70 plateau the in-domain corpus produced.

The SciFact sweep selects **0.50**; the production constant stays **0.45**, chosen on the in-domain
tuning split. That is deliberate: IndexFlow's domain is workspace documents, not scientific claim
verification, and the product constant should follow the in-domain corpus. Recorded so the
difference is not mistaken for drift.

### Still outstanding in this phase

- **NFCorpus has not been run.** Graded-gain support (`ndcgAtGraded`) is implemented and unit-tested
  against the binary implementation, but the archive is not yet SHA-pinned and no run exists. Until
  then, the "graded relevance makes nDCG informative" argument is a design claim, not a result.
- **SciFact is binary**, so nDCG@10 above still carries no information MRR does not. It is
  reported because it is the metric the published baselines use, which is its own justification.
- **No reranker at scale.** The scale runner omits it deliberately (≈11k cross-encoder pairs would
  dominate the run). So hybrid+rerank is unmeasured on SciFact.

**Gate: Phase 8 SciFact leg complete. Reported to the user.**

---

## 2026-08-05 — Phase 8b: NFCorpus, plus the recall diagnostics

User asked whether the metrics are weak. On the scores: no — hybrid's nDCG@10 of 0.707 sits above
published BM25 (0.665) on a scale our own BM25 reproduces to within 0.02. On the *suite*: yes, and
two gaps are cheap enough to close in this run.

- **Recall@100 is absent and `CANDIDATE_LIMIT = 30` may be capping recall.** R@10 = 83% on SciFact
  could be a ranking result or a candidate-pool result; nothing currently distinguishes them.
- **Nothing is measured at the k that ships.** Production retrieves 30 and passes **6** contexts to
  the generator. R@6 has never been reported.

Both are added here. Method follows Phase 3: retrieve once at depth 100, and truncate to 30 for the
headline numbers, since truncating a ranked list to k is exactly what retrieving k returns. A new
**pool ceiling** row reports the fraction of relevant documents present anywhere in the union of
the two legs' candidates — separating "ranked badly" from "never retrieved at all".

### NFCorpus, measured from the download

3,633 documents (median 237 words). Splits: dev 324 queries / 11,385 judgments / **graded (1, 2)**;
test 323 queries / 12,334 judgments / **graded**; train 2,590 queries but **binary only**.

Using **dev as the tuning split**, not train: dev is graded exactly like test, so the weight is
selected on data of the same character it is scored on — the split-composition mismatch that Phase
3 found in the in-domain set. Archive pinned at
`efe5be03f8c5b86a5870102d0599d227c8c6e2484328e68c6522560385671b0b`.

### Pre-registration

**Prediction 1 — MRR becomes useless here.** With ~38 relevant documents per query, hitting *one*
early is easy. I predict **MRR ≥ 0.5 for every strategy**, carrying almost no information. This is
the mirror image of the in-domain corpus, where dense-but-tiny labels made R@5 useless; here
sparse-metric MRR is the casualty. nDCG@10 and recall@100 are the metrics that should be read.

**Prediction 2 — R@5's ceiling collapses.** `min(5, 38)/38 ≈ 0.13`, so the R@5 ceiling should land
near **0.15**, and raw R@5 will look catastrophic (~0.10) while being a respectable fraction of
attainable. Without the ceiling row this number would be unreadable — the strongest demonstration
yet of why Phase 2 added it.

**Prediction 3 — external anchor.** Published BM25 on NFCorpus is commonly cited at **nDCG@10 ≈
0.325**. Having underestimated BM25 once already on SciFact, I now predict our BM25 lands
**0.29–0.34**, i.e. close to published rather than well below it.

**Prediction 4 — the mechanism hypothesis, under test.** SciFact produced the claim that *blending
helps when the legs are comparably strong and hurts when one dominates*. On NFCorpus the published
BM25 and MiniLM figures are close (≈0.325 vs ≈0.318), so the mechanism predicts **hybrid beats both
again, significantly**. This is a genuine test: if the legs come out comparable and hybrid does
*not* win, the mechanism I proposed after SciFact is wrong and I will say so.

**Prediction 5 — graded versus binary.** Grade-2 judgments are rare (576 of 12,334, 4.7%). I predict
graded nDCG@10 lands **within ±0.03 of what binary scoring would give**, because the grades are too
sparse to move the ranking much. Low confidence, and worth measuring precisely because the
"graded labels make nDCG informative" claim should be checked rather than assumed.

**Prediction 6 — the candidate pool is the binding constraint at depth 30.** With ~38 relevant
documents per query, a 30-candidate pool cannot contain them all. I predict the pool ceiling at
depth 30 is **well below 0.5**, and that R@100 is much larger than R@10 — meaning depth, not
ranking, is what limits recall on this dataset.

### Result — NFCorpus, 3,633 documents, 323 held-out queries

Run: [CI 30982743336](https://github.com/JCHETAN26/IndexFlow/actions/runs/30982743336), 623 s wall.
Dataset `beir-nfcorpus-2021`, docs `c447d420f487`, queries `fed3af99af14`.

```
Strategy         MRR    R@1     R@6*    R@10    P@3     nDCG@10
keyword        0.50     5.7%   12.7%   14.8%   32.7%   29.9%
semantic       0.51     4.2%   12.3%   14.8%   34.2%   30.8%
hybrid         0.53     5.1%   14.4%   16.4%   38.1%   33.2%
ceiling        1.00    17.9%   50.2%   61.5%   92.9%  100.0%
   * R@6 = the k that reaches the generator

depth diagnostics — is CANDIDATE_LIMIT=30 the binding constraint?
  keyword    R@10 14.8%   R@30 18.0%   R@100 22.8%
  semantic   R@10 14.8%   R@30 19.8%   R@100 28.0%
  hybrid     R@10 16.4%   R@30 22.8%   R@100 31.2%
  candidate pool ceiling: 24.3% at depth 30, 32.6% at depth 100

graded vs binary nDCG@10:
  keyword   graded 29.9%  binary 29.9%  delta +0.03pp
  semantic  graded 30.8%  binary 31.1%  delta −0.30pp
  hybrid    graded 33.2%  binary 33.3%  delta −0.07pp

paired bootstrap:
  Δ semantic − keyword   +0.008 [-0.031, 0.046]   not significant
  Δ hybrid − keyword     +0.032 [ 0.002, 0.062]   SIGNIFICANT
  Δ hybrid − semantic    +0.023 [ 0.004, 0.044]   SIGNIFICANT
```

### THE HEADLINE: depth is the constraint, not ranking

**Hybrid's R@30 is 22.8% against a candidate pool ceiling of 24.3% at the same depth.** It is
capturing **94% of everything reachable**. Ranking on this dataset is very nearly optimal; what
limits recall is that the relevant documents are never candidates in the first place.

This has a direct engineering consequence, and it is the opposite of the intuitive one: **a
reranker cannot help here.** Its maximum possible contribution at depth 30 is 1.5 percentage
points, because no reranker can promote a document that was never retrieved. To improve recall on a
densely-labelled corpus the lever is `CANDIDATE_LIMIT`, not a better ranker. Raising depth 30 → 100
moves the pool ceiling 24.3% → 32.6% and hybrid recall 22.8% → 31.2%.

This is the question the user raised — whether the metrics are weak — answered with a measurement
rather than an opinion. The metric that was missing is the one that turned out to matter most.

### The mechanism hypothesis replicates

SciFact produced the claim that blending helps when the legs are comparably strong and hurts when
one dominates. NFCorpus was a genuine test of it, pre-registered, and it holds:

| corpus | keyword vs semantic | hybrid vs both |
|---|---|---|
| in-domain (17 docs) | semantic +0.22, dominant | **−0.08, significantly worse** |
| SciFact (5,183 docs) | +0.015, **not significant** | **+0.056 / +0.071, significant** |
| NFCorpus (3,633 docs) | +0.008, **not significant** | **+0.032 / +0.023, significant** |

Three corpora, two independent confirmations. The rule now has real support: **hybrid is worth
running when neither leg dominates, and is actively harmful when one does.** That is a more useful
statement than anything in the current `RESULTS.md`, and it is falsifiable.

The NFCorpus sweep also independently selected **0.45**, the production constant.

### Predictions scored: 4 of 6

| # | Prediction | Outcome |
|---|---|---|
| 1 | MRR ≥ 0.5 everywhere and uninformative | **Confirmed.** 0.50/0.51/0.53, CIs heavily overlapping, while nDCG@10 separates them cleanly |
| 2 | R@5 ceiling collapses to ≈0.15 | **Wrong.** R@6 ceiling is 50.2% |
| 3 | Our BM25 lands 0.29–0.34 | **Confirmed.** 0.299 against a published ≈0.325 |
| 4 | Legs comparable → hybrid beats both significantly | **Confirmed.** The mechanism survives an independent test |
| 5 | Graded within ±0.03 of binary | **Confirmed**, ten times tighter than predicted |
| 6 | Pool ceiling well under 0.5; R@100 ≫ R@10 | **Confirmed.** 24.3%, and R@100 roughly doubles R@10 |

**Why prediction 2 was wrong, recorded because the error is instructive.** I computed the ceiling
from the *mean* of ~38 relevant documents per query: `min(6,38)/38 ≈ 0.16`. But the distribution is
heavily right-skewed — the R@1 ceiling of 17.9% implies a typical query has around 5 relevant
documents, not 38. Reasoning from a mean over a skewed distribution gave an answer off by a factor
of three. The `ceilingFor` machinery computed it correctly from the actual labels, which is exactly
the argument for computing ceilings rather than estimating them.

### A finding that undercuts my own reasoning for choosing NFCorpus

I selected NFCorpus partly because **graded** relevance would make nDCG carry information binary
labels cannot. **Measured, the grades are worth essentially nothing: ±0.3 percentage points, and
for two of three strategies the graded score is fractionally *lower*.** Grade-2 judgments are only
4.7% of the total, too sparse to move a ranking.

So the original review's §3.5 remedy — "add graded relevance and NDCG becomes meaningful" — is, on
this evidence, **not the mechanism that makes nDCG useful.** What made nDCG useful here was
**label density**, not grading. With ~38 relevant documents per query, nDCG@10 separates the three
strategies by 3.3 points while MRR separates them by 0.03 and cannot distinguish them at all. Many
relevant documents per query is the property that matters; graded relevance on top of it is close
to a rounding error.

The graded code path is still correct and still worth having — it is unit-tested to agree with the
binary implementation to 12 decimal places, and a corpus with denser high grades would exercise it.
But it should not be sold as the thing that fixed nDCG.

### Also worth noting

Raw R@6 of 12–14% looks catastrophic and is not: the ceiling is 50.2%, so hybrid reaches 29% of
attainable. Conversely P@3 of 38.1% looks poor and is genuinely poor — its ceiling here is **92.9%**,
because with dozens of relevant documents almost any three could be right. The same two numbers
would be read backwards without the ceiling row, in opposite directions.

**Gate: Phase 8 complete — both BEIR subsets run. Reported to the user.**

---

## 2026-08-05 — Documentation rewrite, and a correction to my own conclusion

### Documentation

`RESULTS.md` and `README.md` rewritten against six phases of measurement. Three claims retired,
each with the superseded number struck through and its reason retained per the brief's deliverable:

1. ~~"small gaps are noise, do not rank configurations by them"~~ — the paired interval on
   semantic−hybrid is +0.08 [0.01, 0.16] and excludes zero.
2. ~~"hybrid is the best configuration for exact-match queries"~~ — a three-way tie on held-out data.
3. ~~"hybrid does not beat both single strategies"~~ as a general claim — true of 17 documents,
   false on both public corpora.

Added: §1b for the BEIR runs and the external anchor; ceilings beside every metric; the saturation
statement; reranking's benefit marked as not statistically supported; six new entries under "what
these numbers do not say" covering unaudited labels, unmeasured generation at scale, the n=1
rejection signal, and the unmeasured cost of ACL filtering on ranking quality.

### CANDIDATE_LIMIT sweep — and I was wrong

Run: [CI 31012455747](https://github.com/JCHETAN26/IndexFlow/actions/runs/31012455747), NFCorpus.

```
  depth   MRR     R@6      R@10     nDCG@10   pool ceiling
  10      0.53     13.5%    15.7%    31.7%     17.7%
  20      0.53     14.1%    16.4%    32.9%     22.0%
  30      0.53     14.4%    16.4%    33.2%     24.3%   <- production
  50      0.53     14.1%    16.9%    33.7%     27.7%
  100     0.54     14.1%    16.8%    33.9%     32.6%
```

**Correction to the previous entry.** After the first NFCorpus run I concluded: "the lever for
recall on a densely-labelled corpus is `CANDIDATE_LIMIT`, not a better ranker." **That is wrong at
consumable k.** Going 30 → 100 raises the pool ceiling by a third and moves R@6 from 14.4% to
**14.1%** — slightly down — with nDCG@10 up 0.7 points. The extra candidates are reachable and
never ranked high enough to be consumed.

The error: I inferred a lever from R@30 and R@100, cutoffs nobody consumes. The RAG path passes
**6** contexts. I had added R@6 in the very same commit for exactly this reason and then reasoned
from the deep numbers anyway.

**Decision: `CANDIDATE_LIMIT` stays at 30.** A deeper pool costs latency in both legs and in the
blend and returns nothing measurable at the k that ships.

**What this leaves open.** The "a reranker can add at most 1.5 points" bound is real at k=30 and
**does not transfer to k=6**. At k=6 hybrid retrieves 14.4% against a label ceiling of 50.2%, with
24.3% of relevant documents sitting in the candidate pool — so there is headroom for better
*ordering* of the pool already retrieved. The oracle-rerank ceiling at k=6 is **not measured**, so
the size of that headroom is an open question, not a claim. That is the single most useful next
measurement for retrieval quality.



---

## 2026-08-05 — Phase 10

Run: [CI 31044703693](https://github.com/JCHETAN26/IndexFlow/actions/runs/31044703693), all jobs green.

### 10.1 Adversarial false-positive control

The usability half was **two** legitimate queries, both answerable from a single public document
reading "Rules: Be polite." A system that refuses everything scores a perfect zero disclosures and
zero injection leaks, so the safety numbers are meaningless without this control.

Expanded to a benign public corpus of 8 factual documents and **32 legitimate queries**. Refusal is
detected from the generator's own `refused` flag (`lib/llm` `looksLikeRefusal`) rather than by
keyword-matching the answer, so a correct answer phrased unexpectedly is not miscounted. Wrong
answers are tracked separately from refusals — they are different failures and conflating them
hides which is happening.

**Two defects found while implementing it, both in code that produces a published number:**

1. `Prompt injection leaks: 0 of 10 attempts.` was a **hardcoded string**. A successful injection
   incremented `answerFails` and failed the gate, but the printed line still read "0 of 10". The
   figure quoted in `RESULTS.md` §5 and the README was therefore a literal, not a measurement. Now
   counted in its own variable.
2. A false refusal incremented `answerFails`, the same counter as a security failure, so a
   *usability* miss was reported as `Vulnerability leak(s) detected` and failed the build. The gate
   is now security-only. Gating on usability would create pressure toward a more refusing system —
   precisely the direction that inflates the safety score.

**Not run.** `eval:adversarial` needs Postgres, Elasticsearch *and* Ollama. CI has the first two and
no Ollama; this machine has no Docker. The code and fixtures are in place and the numbers are
unmeasured. The existing `0/30` and `0/10` figures stand as the last captured run, with the caveat
above now attached to the injection line.

### 10.2 R@1 naming

Added `hitRateAt` — the share of judged queries with **any** relevant document in the top k, which
is what a reader assumes "R@1" means. On this label set an oracle scores hit-rate@1 of **1.00** and
recall@1 of **31/33 = 0.94**, because recall divides by the number of relevant documents and four
queries have two. Both are now reported side by side; recall stays because it is what published
baselines use. Four unit tests pin the distinction, including one asserting that hit rate and
recall diverge exactly where multi-relevant queries appear.

### 10.3 Sweep precision

The sweep printed 2dp against a `bestScore - 1e-9` tie-break, so a 0.0004 difference was invisible
and the tie-break could silently decide the weight. Now 4dp, plus an explicit line reporting how
many of the 21 weights sit within 1e-9 of the maximum and the span of that plateau.

### 10.4 Oracle-rerank headroom — the open question, closed

```
  k     hybrid R@k    oracle rerank   headroom    label ceiling
  6      14.4%         21.7%          +7.3pp       50.2%
  10     16.4%         23.5%          +7.0pp       61.5%
  30     22.8%         24.3%          +1.4pp       84.9%
```

`oracleRerankAt` computes the best recall@k achievable by perfectly reordering the pool already
retrieved at depth 30 — the exact headroom available to ranking, with everything above it requiring
better candidates.

**At the k that ships, perfect reordering is worth +7.3 points, a 51% relative gain.** My earlier
"a reranker can add at most 1.5 points" was measured at k=30 and understated the opportunity by a
factor of five at k=6. Combined with the depth sweep, the picture is now unambiguous:

| lever | measured value at k=6 |
|---|---|
| deeper retrieval (30 → 100) | **0.0pp** |
| perfect reordering of the existing pool | **+7.3pp** |
| beyond that (21.7% → 50.2%) | better candidates, and depth is not how to get them |

Reranking is the live opportunity; depth is not. That is the reverse of what I concluded two
entries ago, and it is now measured rather than inferred from cut-offs nobody consumes.

Caveat on the claim: +7.3pp is what a *perfect* reranker would win. The cross-encoder actually
implemented shows no statistically significant in-domain benefit and has never been run at scale.

**Gate: Phase 10 complete — 10.2, 10.3 and 10.4 measured; 10.1 implemented but unrun for lack of
an Ollama-capable environment.**


---

## 2026-08-05 — Phase 9b: latency at scale, correctly measured

Run: [CI 31046256117](https://github.com/JCHETAN026/IndexFlow/actions/runs/31046256117) — 1k/10k/50k
synthetic chunks, 150 queries per scale after 20 warmup, 3 independent repeats.

### The impossible number, explained and fixed

The brief flagged that hybrid p50 sat *below* keyword p50 at three of four scales, which cannot
happen for a strategy that awaits both legs. **Cause found in `measure()`:** it ran keyword, then
semantic, then hybrid — fixed order, on the *same* query string and vector, every iteration. By the
time hybrid ran, Elasticsearch had just served that exact query and Postgres had just executed that
exact vector scan, so both of hybrid's legs were answered from caches the two standalone
measurements had populated. Hybrid was being timed against a warm cache its own competitors paid to
fill.

Fixed by giving every (trial, strategy) pair its **own** query — so no strategy inherits another's
warm cache — and shuffling strategy order per trial. A guard now prints a loud warning if hybrid
p50 lands below the slower leg, because that is proof the numbers are not measuring what they claim.

### Result

```
scale     strategy   p50    p95    p99   mean   per-run p50 (3 runs)   ANN recall@10
1,000     keyword    5.7   12.3   16.8    6.8   9.0 / 5.3 / 5.2        100.0%
          semantic   1.5    2.5    4.0    1.6   1.8 / 1.3 / 1.4
          hybrid     5.9   13.1   23.1    7.1   9.1 / 5.4 / 5.3
10,000    keyword    5.8    7.6   10.0    6.0   5.7 / 5.9 / 5.7        100.0%
          semantic   1.5    1.9    2.3    1.5   1.4 / 1.5 / 1.5
          hybrid     5.9    7.9   11.0    6.0   5.9 / 6.0 / 5.7
50,000    keyword    6.9    9.4   10.9    6.9   7.4 / 6.7 / 6.7        100.0%
          semantic   1.3    1.7    3.0    1.3   1.4 / 1.2 / 1.2
          hybrid     6.9   10.1   12.7    7.0   7.2 / 6.7 / 6.6

HNSW build: 37.7ms @1k · 586.7ms @10k · 4,615.3ms @50k
```

**No warning fired at any scale.** Hybrid p50 now sits at or just above the slower leg, which is the
only physically possible arrangement. The relationship is exactly `hybrid ≈ max(keyword, semantic) +
blend`, and keyword dominates.

### What the corrected numbers say

1. **The Elasticsearch hop is the entire hybrid latency budget.** Keyword 5.7–6.9 ms against
   semantic's 1.3–1.5 ms — in-process pgvector is roughly 4× faster than the ES round trip. The
   earlier diagnosis was right; it now rests on a sound measurement.
2. **Semantic latency is flat, and slightly *decreases* with scale** (1.5 → 1.5 → 1.3 ms across a
   50× corpus growth). HNSW is behaving sublinearly as claimed.
3. **ANN recall@10 is 100.0% at every scale**, so the speed is not being bought with recall. This
   closes the "measures only the speed half" gap — but see the caveat below, which matters.
4. **Run-to-run spread vindicates the repeats requirement.** At 1k, keyword per-run p50 was
   **9.0 / 5.3 / 5.2 ms** — the first run 70% higher than the other two. A single run would have
   published 9 ms as the 1k latency and invited a story about small-index overhead. It is warmup.
5. **HNSW build is the real cost of scale**: 37.7 ms → 586.7 ms → 4.6 s, growing faster than
   linearly (15× for a 10× corpus, 7.9× for a further 5×). Re-indexing, not querying, is what a
   larger corpus makes expensive.

### The caveat that limits finding 3

**ANN recall of 100% on this corpus does not imply 100% on real embeddings.** The vectors here are
uniform random unit vectors, which in 384 dimensions are very nearly orthogonal to one another, so
true nearest neighbours are widely separated and trivially easy for HNSW to find. Real embeddings
are strongly clustered, which is the regime where HNSW actually loses recall. This measurement
establishes that the index is correctly built and queried; it does **not** establish that ANN recall
is safe in production. Measuring recall on real embeddings requires the scale-eval path
(`eval:scale`), which currently disables index scans to force exact KNN — running it both ways at a
fixed corpus size is the honest version of this measurement and is **not yet done**.

**Gate: 9b complete. 9a and 9c outstanding.**


---

## 2026-08-06 — Phase 9a: quality vs corpus size, to 100,000 documents

User asked for the full 100k rather than the scoped-down version. Delivered.

Runs: [embed matrix + curve, CI 31070390717](https://github.com/JCHETAN26/IndexFlow/actions/runs/31070390717).
12 parallel embed shards (~15 min each), then a 589 s evaluation job.
Dataset `f2b5809f7e56ec8d` — 100,000 documents, 667 judged, **195,980 chunks**.

### Feasibility, and how it was made to fit

Embedding 195,980 chunks at the measured 15.5 chunks/s is **3.5 hours** on one runner — inside the
6-hour ceiling but with no margin, and one hiccup wastes it. Sharded 12 ways it is ~15 minutes of
wall clock. Vectors move between jobs as raw little-endian float32 (301 MB); as JSON they would
have been roughly 3 GB.

Correctness rests on all 12 shards agreeing on the global chunk ordering without ever seeing each
other. Every ordering is an explicit sort, each shard stamps a `datasetSha`, and the consumer
refuses to scatter vectors unless all 12 agree. Verified locally first at 600 docs / 4 shards: all
shards agreed on 1,453 chunks, reassembly left no unfilled slot, every sampled vector had unit norm.

One failure on the first attempt: **2 of 12 shards died with `ECONNREFUSED`** fetching the 70 MB
TREC-COVID archive. Twelve jobs hitting a university server simultaneously on a cold cache. Fixed
with a single cache-warming job before the matrix plus jittered retry — better behaviour toward
someone else's host, not merely more reliable.

### The curve

```
docs      chunks    w     MRR     R@6      nDCG@10   vs 500
500       1,085     0.50  0.68     72.3%    68.5%    +0.0pp
5,000     11,155    0.50  0.68     79.1%    70.9%    +2.3pp
25,000    49,999    0.50  0.63     73.9%    66.2%    -2.3pp
100,000   195,980   0.50  0.59     69.2%    61.7%    -6.8pp

Δ MRR (500 − 100,000 docs) = +0.088 [0.025, 0.147]   excludes zero: YES
```

**Quality degrades with corpus size, and the degradation is statistically real** — the paired
bootstrap over per-query MRR excludes zero across a 200× corpus growth. This is the scalability
measurement that actually matters, and it now exists.

The rate is the useful part: **a 200× corpus costs 6.8 nDCG points.** Not catastrophic, not free.

### The decomposition, which is more interesting than the headline

Per-strategy nDCG@10 across the tiers:

| docs | keyword | semantic | hybrid | best single |
|---|---|---|---|---|
| 500 | 62.0% | **68.2%** | 68.5% | semantic |
| 5,000 | 64.8% | 64.8% | **70.9%** | tied |
| 25,000 | **60.2%** | 57.2% | 66.2% | keyword |
| 100,000 | **57.8%** | 52.0% | 61.7% | keyword |

**1. The dense leg degrades three times faster than BM25.** Semantic loses 16.2 points from 500 to
100k; keyword loses 4.2 from its peak. Every added distractor is another chance for the embedding
space to rank something spurious above the answer, and MiniLM's 384 dimensions have less room to
keep 196k chunks apart than BM25's vocabulary does.

**2. There is a complete crossover.** At 500 documents semantic beats keyword by 6.2 points; at
100,000 keyword beats semantic by 5.8 points. **Which retrieval strategy is better is a function of
corpus size**, and any claim that omits the corpus size is unfalsifiable. The in-domain corpus has
17 documents, which is why semantic looked so dominant there.

**3. Quality is non-monotonic: 5,000 documents scores *better* than 500** (+2.3 nDCG). The cause is
visible in the decomposition — keyword *improves* from 62.0% to 64.8% over that step while semantic
falls. BM25 needs corpus statistics to estimate IDF, and 500 documents is not enough to estimate
them well. So the smallest tier is not the easiest task; it is the one where the keyword leg is
least informed.

**4. Hybrid's advantage over the best single strategy grows, then shrinks:** +0.3, +6.1, +6.0,
+3.9 points. It is worth least at 500 documents, where semantic dominates and blending adds
nothing. That is a **third independent confirmation of the mechanism** proposed after SciFact —
and the cleanest, because here only corpus size varies while the query set, the labels and the
blend weight (0.50 at every tier) are all held fixed.

### ANN recall on real embeddings — my caveat was wrong

```
ANN recall@10 on real embeddings, 195,980 chunks: 100.0% (50 queries)
```

After 9b I recorded a caveat: 100% ANN recall on uniform random vectors "does not imply 100% on
real embeddings, because real embeddings are clustered, which is the regime where HNSW actually
loses recall." **Measured on real MiniLM embeddings over 195,980 chunks, recall@10 is still
100.0%.** The caveat was over-cautious. pgvector's default HNSW parameters lose nothing at this
scale on this data, and the 9b number stands rather than needing the hedge I attached to it.

This also removes an explanation for finding 1: the semantic leg's degradation is **not** an ANN
artifact. Exact search would return the same neighbours. The embedding model itself is what stops
separating documents as the corpus grows.

### Index build time is the real cost of scale

```
1,085 chunks    0.2 s
11,155 chunks   1.5 s
49,999 chunks  14.6 s
195,980 chunks 125.2 s
```

Superlinear: a 4× corpus from 50k to 196k costs 8.6× the build time. Querying stays flat (9b);
**re-indexing is what a larger corpus makes expensive**, which is what matters for a system whose
ACL changes trigger re-projection.

### What this does not say

- **One run per tier.** The curve is four points, each measured once. The 500→5,000 rise is +2.3
  points and has no error bar; only the 500-vs-100,000 comparison was significance-tested.
- **Distractors are TREC-COVID**, scientific abstracts like SciFact. Chosen so they are hard
  negatives, but the degradation rate would differ with a differently-related distractor pool. A
  corpus of unrelated documents would degrade more slowly and flatter the system.
- **The judged set is fixed at 667 documents** while distractors grow. That is the correct design
  for this question, but it means the 100k tier is not "a 100k-document benchmark" — it is a
  667-document benchmark with 99,333 distractors.
- Still out of domain: this measures the retrieval stack, not permission-aware workspace search.

**Gate: Phase 9a complete. 9c (end-to-end ingestion throughput) outstanding.**
