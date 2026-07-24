# Metrics & Proof — IndexFlow

> All numbers below come from **local evaluation runs on small labeled fixture sets**, not from production. Frame them that way. No scale, latency-benchmark, uptime, or user metrics exist.

## Verified Metrics

| Metric | Value | Source / Evidence | Confidence | Resume-safe | Notes |
|---|---|---|---|---|---|
| Hybrid retrieval MRR | **0.98** | `apps/web/eval/harness.ts`, `eval/run.ts`, README "Measurement & verification"; runs in CI (`.github/workflows/ci.yml`) | 0.9 | Yes | On a 17-doc / 27-query labeled set (`eval/corpus.json`, `eval/queries.json`). Beats semantic 0.96 and keyword 0.92. |
| Semantic MRR | 0.96 | same as above | 0.9 | Yes | Same labeled set. |
| Keyword (BM25) MRR | 0.92 | same as above | 0.9 | Yes | Same labeled set. |
| Hybrid R@1 on exact queries | 100% | `eval/harness.ts`, README | 0.85 | Yes | By-query-kind breakdown; "exact" subset. |
| Keyword MRR gain from ES BM25 vs Postgres FTS | 0.48 → 0.92 | README FAQ, migration history (`prisma/migrations/*_fts_gin_index` retained) | 0.75 | Yes (with caveat) | Same corpus; a before/after on the same eval, not a live benchmark artifact. |
| RAG faithfulness (answerable) | **98%** | `apps/web/eval/rag-harness.ts`, README | 0.75 | Yes (framed) | Single local run, 32-question set (`eval/answers.json`), judged by `bespoke-minicheck`. |
| RAG refusal correctness (unanswerable) | **92%** | `eval/rag-harness.ts`, README | 0.75 | Yes (framed) | 12 unanswerable questions incl. adjacent-topic distractors. |
| RAG answer relevance / citation / context recall | 100% each | `eval/rag-harness.ts`, README | 0.7 | Yes (framed) | Same single run; judged by `qwen2.5:7b` + retrieval labels. |
| Permission leak test | **9/9 pass** | `apps/web/eval/acl-leak.ts` | 0.9 | Yes | Deterministic; drives the real retriever + answer path; restricted doc never retrieved/cited even as top match. |
| Sharing lifecycle check | **8/8 pass** | `apps/web/eval/sharing-check.ts` | 0.9 | Yes | Deterministic; grant/revoke/public flips retrieval visibility on both legs. |
| Chosen hybrid weight | 0.4 | `lib/hybrid.ts` (`DEFAULT_HYBRID_WEIGHT`), weight sweep in `eval/harness.ts` | 0.9 | Yes | Selected by an offline sweep, not guessed. |
| CI quality gate | Passing (build + eval) | `.github/workflows/ci.yml`, PR check history | 0.9 | Yes | Retrieval eval runs on real Postgres + Elasticsearch service containers per PR. |
| Embedding dimensionality | 384 (`all-MiniLM-L6-v2`) | `lib/embed.ts`, `prisma/schema.prisma` (`vector(384)`) | 0.95 | Yes | Factual. |
| Codebase size | ~6,900 lines TS/TSX (`apps/web`) | `find … | wc -l` (excl. node_modules) | 0.9 | Optional | Scope indicator, not an achievement. |

## Partially Verified Metrics

| Metric | Value | Why it needs confirmation |
|---|---|---|
| Search latency | ~991 ms (hybrid, one query) | Single-run UI readout on an 8 GB dev machine; not a benchmark, no percentiles, no warm/cold control. |
| RAG answer latency | ~22.7 s (one query) | Single run, cold local `llama3.2:3b` on 8 GB RAM; not representative or benchmarked. |
| RAG numbers stability | 98% / 92% | One run only; local LLM judges are non-deterministic run-to-run. Re-run N times for a mean ± variance before treating as a firm number. |

## Unsupported Metrics (do NOT claim)
- Any throughput/scale number (docs/sec, QPS, 10k/100k/1M docs) — no load testing exists.
- p50/p95/p99 latency — never measured.
- Uptime / availability (e.g. 99.9%) — never deployed.
- Number of real users, teams, or documents in production — none.
- Cost savings, business impact, or adoption — none.
- Cache hit rate, memory/CPU utilization under load — not measured.

## Recommended Resume Metrics (safe to use, with framing)
- "Hybrid retrieval reached **MRR 0.98** vs 0.96 semantic / 0.92 keyword on a labeled 27-query evaluation set, with the blend weight chosen by an offline sweep."
- "Grounded RAG scored **98% faithfulness and 92% refusal correctness** on a 32-question LLM-judged eval (local models), on a set deliberately seeded with multi-hop and adjacent-topic distractors."
- "Permission-aware retrieval verified by a leak test (**9/9**) proving restricted documents are never retrieved or cited — even when the most relevant match."
- "Retrieval quality gated in CI on real Postgres + Elasticsearch containers on every PR."

## If Stronger Metrics Are Wanted (suggested additions)
- **Scale/latency benchmark:** generate a synthetic corpus (10k / 50k / 100k docs), measure ingestion throughput and p50/p95/p99 query latency for keyword vs semantic vs hybrid; commit the output. This is the single biggest missing artifact.
- **RAG eval stability:** run `eval:rag` N times, report mean ± std; add a larger/hosted-judge configuration.
- **Unit/integration tests:** add Vitest for `lib/hybrid.ts`, `lib/acl.ts`, `lib/chunk.ts` to complement the evals.
