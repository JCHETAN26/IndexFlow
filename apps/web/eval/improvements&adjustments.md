# IndexFlow — evaluation hardening and scale proof

## Your role

You are the principal engineer responsible for the retrieval quality of a RAG system that other
people will make decisions with. Your job is not to make the numbers look good. Your job is to make
them **true**, and to make it impossible for a future reader — including a hostile one — to find a
way the numbers could be wrong that you did not already find and disclose.

The repository already has unusually good measurement discipline: a tuning/held-out split, bootstrap
CIs, dataset SHA fingerprinting, human-calibrated LLM judges, and a documented history of retiring
claims that held-out data contradicted. **Match that standard or exceed it. Do not regress it.**

## Non-negotiables

1. **Never report a number you did not produce.** No estimates, no "approximately," no carrying a
   figure forward from a previous run. If you did not run it in this session, do not write it down.
2. **Report the number that hurts.** If a change makes results worse, that is the finding. Write it
   down and keep going. Regressions are results.
3. **Never tune against the held-out split.** Any hyperparameter, threshold, or configuration choice
   is made on the tuning split only. If you catch yourself re-running to get a better held-out
   number, stop — that is test-set fitting performed by hand.
4. **Pre-register.** Before any experiment whose outcome could change a conclusion, write your
   prediction into the log file *first*. Then run it. A prediction written after the result is
   worthless.
5. **Verify the instrument before trusting it.** Do not fix anything in Phase 2+ until Phase 1
   proves the metric code is correct. Fixing a system with a broken ruler produces confident garbage.
6. **The findings below are hypotheses from a code review, not established facts.** The reviewer did
   not execute anything. Verify each one empirically before acting on it. If a claim is wrong, say
   so and move on — that is a useful outcome, not a failure.
7. **Stop and report at every phase gate.** Do not silently continue past a failed phase.

Maintain `docs/eval/WORKLOG.md` throughout: every hypothesis, prediction, command, raw output, and
conclusion, in chronological order. Append only. Never rewrite history.

---

## Phase 0 — Understand the system

Read and summarise back to me before touching anything:

- `apps/web/eval/harness.ts`, `run.ts`, `queries.json`, `corpus.json`
- `apps/web/lib/hybrid.ts`, `es.ts`, `embed.ts`, `chunk.ts`, `rerank.ts`, `retrieve.ts`
- `apps/web/eval/RESULTS.md`
- `apps/web/bench/` (latency benchmark)
- `.github/workflows/ci.yml`

Answer specifically:

- What retrieval depth does each leg use, in the **harness** and in the **production search route**?
  Are they the same? If not, the eval is not measuring what ships — say so.
- What exactly does `blendHybrid` do to scores? Does it drop zeros? What happens to a leg's
  lowest-scoring hit under min-max normalisation?
- Which gate rows are computed on held-out rows and which on the whole set?

**Gate: report your understanding and wait for confirmation before proceeding.**

---

## Phase 1 — Prove the metric code is correct

Nothing downstream means anything if the metrics are wrong. `recallAt`, `mrr`, `precisionAt`, and
`ndcgAt` in `harness.ts` are from-scratch implementations that have never been compared against a
reference.

### 1a. Cross-check against a reference implementation

Export the held-out run as TREC-format qrels + run file. Score with `pytrec_eval` or `ir_measures`.
Compare MRR, recall@{1,3,5}, P@3, nDCG@5 against the harness output.

nDCG especially: there are several conventions for building the ideal ranking, truncating IDCG, and
handling relevant documents that never appear in the ranking. If your implementation disagrees with
the reference, **the reference is right** — either fix the implementation or document precisely
which convention you use and why.

Agreement to 4 decimal places on every metric, or investigate until you know why not.

### 1b. Synthetic rankers with known-correct answers

Add `eval/metrics.test.ts`. Substitute synthetic rankers for the real retriever and assert exact
expected values:

- **Oracle** (relevant doc always rank 1) — assert the exact ceiling value. Compute that ceiling by
  hand from the label density first and put it in the assertion. If oracle MRR is not exactly what
  you predicted, something is wrong and you must find it before proceeding.
- **Random** (uniform shuffle over all docs), 100 seeds — assert the mean lands within tolerance of
  the analytically expected value for a corpus of this size. Derive the expectation yourself.
- **Reversed oracle** (relevant doc last) — assert the floor.
- **Duplicate injection** (same chunk twice) — assert `dedupDocs` collapses it and no metric
  double-counts.
- **Empty ranking** — assert no crash, no NaN, no divide-by-zero.

These tests go in CI. They are the regression suite for the instrument itself.

**Gate: report the cross-check table and test results. Do not proceed if anything disagrees.**

---

## Phase 2 — The ceiling problem

**Hypothesis to verify:** the test split contains one query with `relevant: []`. In `recallAt` and
`ndcgAt` the `total === 0` branch skips the numerator but not the denominator; `mrr` has no guard at
all. If the test split is 34 queries, every one of those metrics is capped at 33/34 = 97.06%.

Verify by hand, then check whether the reported R@5 of 97% for semantic, hybrid, and hybrid+rerank
is that ceiling rather than a score. Also compute the P@3 ceiling from label density (queries with
1 relevant doc cap at 1/3) and compare to reported P@3.

If confirmed:

1. Decide and document how unanswerable queries should be scored. Recommended: exclude from
   MRR/recall/nDCG denominators, score separately as a **rejection metric** — did the strategy
   return nothing above a relevance threshold? Retrieving nothing for an unanswerable query is
   correct behaviour and should be credited, not silently penalised.
2. **Print the attainable ceiling next to every metric in the report output.** Permanently. A
   saturated benchmark should be visually obvious in the run log.
3. Re-run and report every metric as both raw value and percentage of ceiling.

**Gate: report the ceiling analysis before and after.**

---

## Phase 3 — Retrieval depth asymmetry

**Hypothesis to verify:** the harness calls `keywordSearch(..., chunks.length, ...)` — every chunk in
the corpus — while the semantic leg uses `LIMIT 10`. Since `blendHybrid` min-max normalises each leg
independently, normalising over a full-corpus tail versus ten tightly-clustered neighbours produces
incompatible score distributions and structurally tilts the blend toward keyword. That is the same
direction as hybrid's observed paraphrase deficit, so it may confound the published conclusion that
blending is net negative.

**Before running anything, write your prediction into the worklog:** what will happen to hybrid's
paraphrase MRR at equal depth, and by roughly how much?

Then run the matrix — tuning split only, since this is a configuration choice:

| keyword k | semantic k |
|---|---|
| 10 | 10 |
| 50 | 50 |
| 100 | 100 |
| all | 10 (current) |

Report hybrid MRR overall and by query kind for each. Re-run the weight sweep at each depth, since
the optimal blend weight may itself depend on depth.

Then pick the depth configuration on the tuning split, and report held-out numbers **once**.

Two possible outcomes, both publishable:

- **Hybrid improves materially at equal depth** → the published conclusion was confounded.
  Correct `RESULTS.md`, state plainly what happened, and preserve the old numbers with an
  explanation rather than deleting them.
- **Hybrid does not improve** → a fourth alternative explanation is ruled out and the original
  finding is stronger. Document it alongside the three already ruled out.

Do not decide which outcome you wanted after seeing the result.

Separately: if the production search route uses different depths from the harness, fix the harness
to mirror production and note that all prior numbers measured a configuration that never shipped.

**Gate: report prediction, matrix, and outcome.**

---

## Phase 4 — Test the right hypothesis statistically

`bootstrapCI` currently produces marginal intervals for hybrid only, and `RESULTS.md` reads their
width as evidence that the semantic/hybrid gap is not a ranking. **Overlapping marginal intervals do
not imply an insignificant difference.** Both strategies are scored on the same queries, so the
comparison is paired.

Implement `bootstrapDelta(perQueryA, perQueryB)` over the **per-query difference** vector, same
deterministic seeding as the existing function. Report for every pair of strategies:

```
Δ MRR (semantic − hybrid) = +0.09 [lo, hi]   excludes zero: yes/no
```

Also report marginal CIs for **all four** strategies, not just hybrid.

Then correct the interpretation in `RESULTS.md`. The current framing errs conservative, which means
the repo may be **understating** its most interesting result. If the paired interval excludes zero,
say so — "blending a weak keyword leg into a strong semantic one measurably hurts retrieval" is a
real negative finding and deserves the right test behind it.

---

## Phase 5 — Close the gate leak

`report.byKind` is computed from `evals` (tune + test) rather than `headlineRows`. Four of six gate
rows therefore include the 30 queries that selected the blend weight.

Point them at held-out rows. Report before/after values for every gate row. If any floor now fails,
**do not lower the floor** — report the failure and let me decide.

---

## Phase 6 — Validate the labels

The LLM judges are calibrated against a blind human. The **relevance labels themselves never were**.
Every retrieval metric in this repository rests on one person's unaudited judgment about which
document answers which query.

Build `judge:labels` by analogy with the existing `judge:calibrate` tooling:

- Sample 20 query/document pairs, including negatives (plausible-but-unlabelled docs).
- Emit a blind CSV with the key held separately.
- Score raw agreement and Cohen's kappa when labels come back.

Pay attention to multi-relevant queries — e.g. a query labelled against two documents where a third
is arguably as relevant. Under-labelling silently deflates recall for every strategy equally, which
makes it invisible in comparisons but wrong in absolute terms.

Flag ambiguous pairs for review rather than resolving them yourself.

---

## Phase 7 — External anchor

Everything so far is self-referential: a correct harness on a 17-document corpus produces correct
answers to a question nobody asked.

Run the harness against **BEIR SciFact and NFCorpus** (both small, both with published baselines).
Report nDCG@10 and recall@100 for BM25 and for `all-MiniLM-L6-v2`, then compare to published
literature numbers.

This is the single strongest validity check available. If your BM25 reproduces the literature's
SciFact nDCG@10, the entire pipeline — chunking, indexing, scoring, metric computation — is
calibrated against the outside world. If it does not, find out why before trusting any in-house
number.

Report the comparison as a table with your value, the literature value, and the delta. Do not
explain away a gap; investigate it.

---

## Phase 8 — Corpus scale-up

17 documents is the binding constraint on everything else. "Find 1 of 17" is a 17-class
classification problem, not retrieval, and it is why R@5 is pinned at ceiling.

Build a labelled corpus of **at least 500 documents** with **150+ queries**. Options, in order of
preference:

1. A public corpus with existing relevance judgements (BEIR subsets, MS MARCO passage subset).
2. Real technical documentation with queries generated by an LLM and a verified sample — if you
   synthesise queries, hand-verify at least 30 and report the verification rate.

Preserve the existing 64-query set as a separate regression suite so historical comparisons remain
possible.

Requirements: maintain the tune/test split discipline, keep the dataset SHA fingerprinting, bump
`DATASET_VERSION`, and re-run everything. **Expect metrics to drop.** A harder benchmark producing
lower numbers is the goal, not a problem.

---

## Phase 9 — Prove scalability

The current benchmark uses random synthetic vectors and measures latency only. That proves the index
is sublinear; it does not prove the *system* scales, because it says nothing about whether retrieval
quality survives a larger corpus, and nothing about end-to-end ingestion.

Three things must be demonstrated separately:

**9a. Quality at scale.** Run the full retrieval eval at increasing real-corpus sizes — 500, 5k,
25k, 100k documents — with real embeddings and real labels, holding the query set fixed. Plot
nDCG@10 and MRR against corpus size. Quality *should* degrade as the candidate pool grows; the
question is how fast. A flat curve means the task is still too easy. This is the scalability
measurement that actually matters and the one nobody does.

**9b. Latency at scale, correctly measured.** Extend the existing benchmark and fix its known
defects:

- Randomise strategy order across trials. The current table shows hybrid p50 *below* keyword p50 at
  three of four scales, which is impossible if hybrid waits on both legs — likely a warming artifact
  from fixed ordering. Resolve it before publishing any latency conclusion.
- Report p50/p95/p99 with run-to-run spread across at least 3 independent runs, not one.
- Measure with real embeddings, not only synthetic vectors, at least at the smaller scales.
- Report ANN recall vs exact KNN at each scale. HNSW trades recall for speed and the current
  benchmark measures only the speed half.

**9c. Ingestion throughput, end to end.** The current "index throughput" figure is bulk-load, not the
real path. Measure documents/sec through the actual BullMQ worker — extract, chunk, embed, write to
Postgres, mirror to Elasticsearch — with 1 and N workers. Report where it saturates and what the
bottleneck is. Include HNSW index build time as a function of corpus size, and state what that
implies for re-indexing.

For every measurement: state the hardware, and state plainly that single-machine numbers on a shared
box are a directional profile and not a production SLA.

---

## Phase 10 — Remaining gaps

- **Adversarial false-positive control.** Currently `0 of 2` benign queries. Two samples measure
  nothing. Add at least 30 legitimate queries and report the false-refusal rate alongside the 0/30
  disclosure rate. The usability half of a security benchmark matters as much as the safety half.
- **R@1 naming.** With multi-relevant queries, R@1 is capped below 1.0 and is not "right answer
  first N% of the time." Either rename it or report hit-rate@1 alongside.
- **Sweep precision.** Print the weight sweep to 4 decimal places so a reader can verify the plateau
  is real rather than an artifact of rounding against `bestScore - 1e-9`.

---

## Deliverables

1. **`docs/eval/WORKLOG.md`** — full chronological record: hypotheses, pre-registered predictions,
   commands, raw output, conclusions. Including the experiments that changed nothing.
2. **`apps/web/eval/RESULTS.md`** — updated, remaining the single source of truth. Every changed
   number carries an explanation of what changed and why. Superseded numbers are struck through with
   their reason, not deleted.
3. **`eval/metrics.test.ts`** in CI — the synthetic-ranker suite from Phase 1.
4. **A findings summary** answering directly:
   - Which of the review's three hypotheses were confirmed, and which were wrong?
   - Does the "blending hurts" conclusion survive the depth fix? With what statistical support?
   - How does the system compare to published BEIR baselines?
   - How does quality degrade with corpus size?
   - What is still unproven, and what would it take to prove it?

## Final instruction

The last section of your summary must be titled **"What I could not verify."** List everything you
asserted that rests on an assumption, a single run, an unaudited label, or a measurement you could
not isolate. If that section is empty, you have not looked hard enough — write it again.