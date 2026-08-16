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
