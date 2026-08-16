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
| Forcing the Elasticsearch refresh instead of awaiting the scheduled one raised per-worker ingestion throughput ~12× | 0.99 → 11.81 docs/s @ concurrency 1 | [`ingestion-benchmark.md`](ingestion-benchmark.md) §2; `bench/ingest-bench.ts`, 3 passes, medians | **UNVERIFIED on shipping code** — measured on build D, which had the (since reverted) batching present but disabled | **No** — needs a clean run on the shipping code, then CI |
| …and 2.4× at concurrency 8 | 7.21 → 17.43 docs/s | same | **UNVERIFIED on shipping code** — same reason | **No** — same reason |
| Per-document ingestion latency fell from ~1 s to ~82 ms | p50 1020 → 82 ms; p95 1065 → 105 ms | same | **UNVERIFIED on shipping code** — same reason | **No** — same reason |
| The shipping code passes every correctness gate | see below | §8 | VERIFIED | Yes |
| The throughput floor was `wait_for` blocking on the 1 s `refresh_interval`, not the pipeline's work | refreshes/doc identical across all four builds (1.02/0.50/0.25/0.13) | ES `refresh.total` counters read per run | VERIFIED | Yes — as a mechanism, without numbers |
| The optimisation preserves read-your-write and cross-store consistency | 23/23 integration, 8/8 consistency, 8/8 sharing, 8/8 leak | [`ingestion-benchmark.md`](ingestion-benchmark.md) §7 | VERIFIED | Yes |
| Batching the projection improves throughput | 0% / −3.5% / −6.6% / +1.8% | §4; ranges overlap at 3 of 4 levels | **WITHDRAWN** | **No** — it does not, and is slower still once the refresh is forced |
| "Two forced ES refreshes per document" (Phase 9c) | — | §4 | **SUPERSEDED** | Only true for re-ingest and ACL change, not first-time ingest |
| Ingestion throughput is 4.5 docs/s | 4.5 docs/s | CI run 31154323242 | SUPERSEDED by Phase 1 pending the CI re-run | Not alongside the new figure |
| Forced refresh is safe at corpus scale | — | not measured; 40-document runs only | **UNVERIFIED** | **No** — see §6.1, revisit at Phase 6's 100K load |
| Re-ingest and ACL-change paths improve similarly | — | not measured | **UNVERIFIED** | **No** |

### Phase 1 résumé candidates

The first is **blocked on two runs**: a clean measurement of the shipping code (the workstation run
attempted after the revert was discarded — passes disagreed 5.34× against a 1.25× limit), and CI
confirmation on the 4-vCPU runner that produced the 4.5 docs/s baseline. One CI run satisfies both.

> Profiled an asynchronous document-ingestion pipeline to the Elasticsearch refresh that bounded
> it, and raised per-worker throughput ~12× (0.99 → 11.8 docs/s, p50 1020 → 82 ms) by forcing the
> index refresh rather than awaiting the scheduled one — preserving the read-your-write guarantee
> and passing all 23 cross-store consistency and permission tests unchanged.

The honest alternative, which needs no CI confirmation and is arguably the better story:

> Built a batched Elasticsearch projection to fix a measured ingestion bottleneck, instrumented the
> engine's own refresh counters to verify it, and found the batching contributed nothing — the
> 89%-of-runtime cost was a one-line `wait_for` blocking on a 1 s refresh clock. Discarded the
> batching, shipped the one line, and recorded both predictions it falsified.
