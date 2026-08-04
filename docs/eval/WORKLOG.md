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

