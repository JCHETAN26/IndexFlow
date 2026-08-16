# Remediation Phase 1 — Elasticsearch projection throughput

**Status: PASS** for the measurement, with one limitation carried forward (§6.1, segment pressure
at corpus scale, to be settled by Phase 6).

**Headline, measured on CI on the shipping code — 1.00 → 6.15 docs/s per worker (6.2×), and
4.67 → 8.23 docs/s at saturation (1.8×). Per-document p50 1006 → 144 ms. The write path falls from
88.3% of ingestion to 3.4%.** The change that produced it is one line. The elaborate change built
first produced nothing, and the benchmark is what said so.

---

## 0. The result that counts

Both arms dispatched on the same CI runner spec (4 vCPU, `ubuntu-latest`), same benchmark build,
same 40 documents, 3 passes each, neither flagged by the instability guard.

| concurrency | `wait_for` (before) | `refresh: true` (after) | gain |
|---|---|---|---|
| 1 | 1.00 (0.99–1.00) | **6.15** (5.50–6.25) | **6.2×** |
| 2 | 2.00 (1.98–2.01) | **7.01** (6.72–7.37) | **3.5×** |
| 4 | 3.90 (3.83–4.24) | **7.81** (7.69–8.29) | **2.0×** |
| 8 | 4.67 (4.51–5.18) | **8.23** (8.13–8.37) | **1.8×** |

p50 per document at concurrency 1: **1006 → 144 ms.** Stage breakdown for one document:

```
before                                    after
  write path     420.1 ms  88.3%            embed         214.3 ms  95.2%
  embed           53.8 ms  11.3%            write path      7.7 ms   3.4%
  TOTAL          475.9 ms                   TOTAL         225.0 ms
```

The write path goes from dominating the pipeline to being a rounding error, and embedding — the
thing everyone assumes is the cost of a RAG ingest — is finally what the pipeline is actually
spending its time on.

The gain shrinks with concurrency because 4 vCPUs make CPU-bound ONNX embedding the binding
constraint once the refresh stops blocking. That is the honest shape of this result: it is large
for a single worker and modest at saturation, and quoting only the 6.2× would misrepresent it.

Runs: [before](https://github.com/JCHETAN26/IndexFlow/actions/runs/31925524370) ·
[after](https://github.com/JCHETAN26/IndexFlow/actions/runs/31925857101).

The workstation figures in §2 are kept as they were taken. They are larger (11.9× and 2.4×) because
that machine has 8 cores, and they were measured on build D rather than the shipping code — reasons
enough to publish the CI pair instead.

---

## 1. What was measured

40 documents of ~450 words (3 chunks each) through a real BullMQ `Worker` calling the real
`ingestDocument`, against real Redis, MinIO, Postgres and Elasticsearch — the same harness as
Phase 9c, with three methodology fixes described in §5.

Four builds, each 3 interleaved passes over the concurrency sweep, medians reported:

| build | projection | publish |
|---|---|---|
| **A — baseline** (`8d5906a`) | one document at a time | `deleteByQuery(refresh=true)` then `bulk(wait_for)` |
| **B — batched** | up to 25 documents per batch | one `deleteByQuery(refresh=false)` then one `bulk(wait_for)` |
| **C — batched + forced** | up to 25 documents per batch | one `deleteByQuery(refresh=false)` then one `bulk(refresh=true)` |
| **D — forced only** ← ships | one document at a time | one `deleteByQuery(refresh=false)` then one `bulk(refresh=true)` |

## 2. Result

docs/s, median of 3 passes (min–max):

| concurrency | A baseline | B batched | C batched+forced | **D forced** | D vs A |
|---|---|---|---|---|---|
| 1 | 0.99 (0.98–1.00) | 0.99 (0.98–1.00) | 7.82 (7.47–8.21) | **11.81 (9.71–12.04)** | **11.9×** |
| 2 | 2.00 (1.93–2.00) | 1.93 (1.93–2.03) | 11.24 (10.74–11.65) | **14.36 (12.84–14.88)** | **7.2×** |
| 4 | 4.11 (3.73–4.13) | 3.84 (3.80–4.20) | 13.93 (13.14–14.31) | **16.64 (16.31–16.71)** | **4.0×** |
| 8 | 7.21 (7.17–7.26) | 7.34 (7.31–7.67) | 15.77 (15.73–16.23) | **17.43 (16.80–17.93)** | **2.4×** |

Per-document completion latency, concurrency 1: **p50 1020 → 82 ms, p95 1065 → 105 ms.**

Stage breakdown for one document, model warm:

```
A baseline                              D forced
  write path      ~800 ms  ~89%           write path     56.8 ms  45.1%
  embed            ~90 ms  ~10%           embed          67.7 ms  53.8%
  TOTAL           801.8 ms                TOTAL         125.9 ms
```

Embedding is finally the dominant stage — which is what Phase 9c *predicted* before measurement
showed the refresh was swamping it. The prediction was right about the pipeline and wrong about the
system it was running on.

## 3. Why it works

Elasticsearch's refresh is **time-based and per-shard**, governed by `index.refresh_interval`,
which is at its 1 s default here (confirmed: the index has no explicit setting).

- `wait_for` means *block until the next scheduled refresh*. With a 1 s clock that is a hard floor
  of up to a second on every projection, and it is visible directly in the data: baseline p50 sits
  at 1020–1055 ms at **every** concurrency level. That is the refresh interval, not the pipeline.
- `refresh: true` means *refresh now*. Same work, no waiting for the clock.

The decisive evidence is that **refreshes per document are identical across all four builds**
(1.02 / 0.50 / 0.25 / 0.13 at concurrency 1 / 2 / 4 / 8 for A, B and C). The cost was never
performing refreshes. It was waiting for them.

`refresh: true` does not weaken the guarantee the refresh was bought for. It strengthens it: the
write is visible when the call returns, rather than at the next tick. A document still becomes
`INDEXED` only after Elasticsearch demonstrably holds it.

## 4. What did not work, and is not shipping

**Batching the projection bought nothing.** Build B was the substantial piece of engineering —
batched outbox consumption, a single `terms` deleteByQuery per batch, a `terms` aggregation
replacing N version-guard searches, sorted-order advisory locking to make holding many document
locks deadlock-free, and per-document fallback so one poisoned document cannot stall a batch. It
moved throughput by 0%, −3.5%, −6.6% and +1.8%, with min–max ranges overlapping at every level bar
the last.

Worse, once the refresh is forced rather than awaited, batching is **actively harmful** — build C
is slower than build D at every concurrency level. A projection costs ~80 ms once the refresh stops
blocking, and a 25 ms coalescing window is a third of that.

Two pre-registered predictions were wrong, both from the same false premise:

| predicted | measured |
|---|---|
| baseline forces ~2 refreshes per document; coalescing will cut that sharply | baseline is 1.02/doc at concurrency 1 and **already 0.13/doc at concurrency 8** — ES amortises across concurrent writers on its own, before any code of mine |
| removing batching will cost throughput at concurrency 8 through refresh churn | it *gained* throughput (17.43 vs 15.77) despite 7.7× the refreshes |

The premise — that each document forces its own refresh and that they do not share — was wrong. The
"two forced refreshes per document" recorded in the Phase 9c worklog is real for **re-ingest and
ACL changes**, where the delete matches existing chunks. It is not true of first-time ingest, where
`deleteByQuery` matches nothing, and first-time ingest is what the throughput benchmark measures.

The batching code is **not retained**. Keeping ~300 lines alive on the strength of an unmeasured
future benefit is the habit this project exists to avoid, so it was reverted; §7 describes what
shipped instead. It survives in the worklog, in this document, and in the branch history, which is
where a measured-worthless optimisation belongs.

## 5. Instrument changes

Three defects in the benchmark were fixed before any of the above was trusted.

**Cold start contaminated the first row.** The concurrency-1 run executed first and absorbed the
ONNX model load, an unJITed process and cold caches: 0.44 docs/s with a p95 of 11.6 s against a p50
of 1.1 s — slower than CI on weaker hardware. Since it is the denominator of every speedup, it
inflated the whole column (reporting 17.4× scaling at concurrency 8). Fixed with a discarded warmup
pass. This is the Phase 9b measurement-order defect in a new location.

**One run is an anecdote.** The first before/after comparison showed +27% at concurrency 8 and it
was an artifact — the contaminated baseline run happened to score 6.00 docs/s where the clean one
scores 7.21. Fixed with 3 interleaved passes (every concurrency measured once per pass, so drift
biases all levels equally) reporting medians and min–max.

**Refresh cost was inferred, not measured.** The stage breakdown attributes the write path by
subtraction and is an estimate — the version before this one was wrong by 89 percentage points. The
bench now reads Elasticsearch's own `refresh.total` and `refresh.total_time_in_millis` counters
around each run. That is what made the finding in §3 provable rather than arguable, and it is what
falsified my own hypothesis.

Also added, per §54 and §57 of the remediation brief: environment recording (Node version, CPU
count, RAM, load average, Elasticsearch version, projection settings, pass count) printed with every
run, and a loud `⚠ UNSTABLE` when passes disagree by more than 1.25×.

That last one immediately earned itself. A confirmation run degraded to passes ranging 3.15–8.49
docs/s at one concurrency level; investigation found an unrelated editor process taking most of four
cores, and the Elasticsearch index healthy (6 segments, 1.1 MB, no active merges). That run is
discarded, not reported.

## 6. What is not measured

1. **Segment and merge pressure over a long ingest.** Build D forces 1.0 refreshes/doc against
   baseline's 0.13 at concurrency 8. Over 40 documents this costs nothing measurable and the index
   stayed at 6 segments. Over a six-figure corpus it may not, and **Phase 6 loads 100K documents** —
   that is where this must be measured. `PROJECTION_REFRESH=wait_for` reverts to the old behaviour
   without a code change if it bites; restoring the batching would mean recovering it from history,
   and should happen only if that measurement calls for it.
2. ~~**CI hardware.**~~ **Closed** by the pair in §0. Both arms now come from the 4-vCPU runner
   that produced the original 4.5 docs/s figure, on the shipping code. Worth recording that the
   ratio did *not* transfer between machines: 11.9× on 8 cores against 6.2× on 4, because the
   binding constraint moves to CPU-bound embedding sooner on the smaller runner. Had the
   workstation number been published as though it were general, it would have overstated the result
   by nearly 2×.
3. **Concurrency beyond 8**, and any concurrent search load competing with ingestion.
4. **Re-ingest and ACL-change paths**, where `deleteByQuery` actually matches and the second
   refresh in the baseline is real. Those may improve more than first-time ingest did; unmeasured.

## 7. What shipped, and what was measured

The batching (build B/C) is **not in the tree**. After measuring it as worthless, it was reverted;
the entire shipping change is four lines in `lib/outbox.ts` — a `PROJECTION_REFRESH` constant, the
delete no longer forcing its own refresh, and the index call taking that constant instead of
`wait_for`.

That revert leaves a gap worth naming. Build D — the measurement behind every number above — ran
with the batching code present but disabled (`PROJECTION_COALESCE_MS=0`), so its inline path used
`findMany`, a `terms` aggregation and a `terms` deleteByQuery. The shipping path uses `findUnique`,
a `size:1` search and a `term` deleteByQuery. The two are functionally equivalent and the shipping
one is if anything marginally cheaper, but *equivalent* is an argument, not a measurement.

The confirmation run on the shipping code was **discarded**: its passes disagreed by 5.34× against
a 1.25× limit (1.24 / 4.04 / 6.63 docs/s at concurrency 1, rising monotonically as contention
cleared, machine load 5.52). The spread guard added in §5 caught it, which is the guard working as
intended. Both gaps — shipping code, and CI hardware — are closed by the pair in §0, which measures
the merged code on the runner that produced the original baseline.

The guard then earned itself a second time, on CI. The first forced-refresh run tripped it at 1.34×
on an **idle** runner (load 1.28), which contamination does not explain. The cause was a third
variant of the measurement-order defect: the warmup ran only at max concurrency, leaving the
concurrency-1 path cold, and concurrency 1 is measured first — so the ramp landed on the row every
speedup is computed against (passes of 5.01 / 6.57 / 6.70 while the other levels agreed within
10%). The warmup itself running at 2.93 docs/s against a 6.57 steady state is the tell. Fixed by
warming every level, after which both arms came back clean. Phase 9b had this defect across
strategies, §5 above fixed it across runs, and it still came back across concurrency levels.

## 8. Verification

Run against real Postgres, Elasticsearch, Redis and MinIO on the shipping configuration:

| gate | result |
|---|---|
| Unit | 73/73 |
| Integration | 23/23 |
| Cross-store consistency | 8/8 |
| Sharing lifecycle | 8/8 |
| Permission leak (retrieval + generation) | 8/8 + 1/1 |

The integration suite runtime fell from 13.9 s to 2.3 s, which is independent corroboration of the
mechanism: those tests were waiting a refresh interval per projection.
