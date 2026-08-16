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
