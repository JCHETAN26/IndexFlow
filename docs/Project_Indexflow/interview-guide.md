# Interview Guide — IndexFlow

## 30-Second Explanation
IndexFlow is a workspace search engine that combines keyword search (Elasticsearch BM25) and semantic vector search (pgvector) into a hybrid ranking, then adds a grounded RAG layer that answers questions with citations and refuses when the documents don't support an answer. The theme is "measure it, don't guess it": retrieval quality, hallucination rate, and access control each have a runnable evaluation. It's also permission-aware — search and RAG only ever return or cite documents the querying user is allowed to see, and I proved that with a leak test. It runs entirely on local models and infrastructure, no API keys.

## 2-Minute Technical Deep Dive
It's a Next.js 15 app plus a standalone BullMQ worker. On upload, a file goes to MinIO and a job is queued on Redis; the worker extracts text (including PDFs via unpdf), chunks it (~180 words, 30-word overlap), embeds it with an in-process MiniLM model (384-dim), and dual-writes to Postgres/pgvector (source of truth + vectors) and Elasticsearch (BM25 + highlighting). I generate chunk ids in app code so the same id keys both stores, which is how hybrid ranking correlates keyword and semantic hits.

At query time, one shared retriever fetches keyword candidates from Elasticsearch and semantic candidates from pgvector, blends them with a min-max-normalize + weighted-sum function whose weight I picked with an offline sweep (0.4), and returns the top results. The RAG route reuses that same retriever, feeds the top passages to a local llama3.2 under a strict grounding prompt (cite every claim, refuse if unsupported), and streams the answer with citations.

Permissions are enforced on both retrieval legs independently: each Elasticsearch chunk carries a denormalized ACL principal list filtered with a terms query, and the pgvector query has an equivalent SQL visibility predicate. The shared retriever requires a viewer, so no call site can accidentally skip the filter. I measure everything: a retrieval eval (recall@k, MRR, weight sweep, gate) that runs in CI on real Postgres + Elasticsearch containers, an LLM-as-judge hallucination eval where the generator and judges are different models, and a leak test that drives the real code and confirms a restricted doc is never retrieved or cited even when it's the most relevant match.

## Architecture Walkthrough
- **UI (Next.js/React):** search + streamed answer, permission-scoped documents list + sharing panel, live eval page.
- **API routes:** `/api/search` (keyword/semantic/hybrid), `/api/answer` (streaming RAG, NDJSON), documents CRUD + upload + sharing, `/api/eval` + `/api/eval/rag`, Auth.js handlers.
- **Shared retriever (`lib/retrieve.ts`):** the one ACL-aware path used by both search and RAG.
- **Stores:** Postgres/pgvector (truth + vectors + ACL), Elasticsearch (BM25 + denormalized ACL), Redis/BullMQ (queue), MinIO (files), Ollama (LLMs).
- **Worker (`worker/index.ts` + `lib/ingest.ts`):** async extract → chunk → embed → dual-write with retry/backoff and idempotent re-index.
- **Eval (`eval/`):** retrieval eval, RAG eval, ACL leak test, sharing lifecycle check.

## Best Resume Talking Points
1. **Measured hybrid retrieval** — MRR 0.98 vs 0.96/0.92, weight chosen by a sweep, gated in CI. Shows I optimize with data, not intuition.
2. **Permission-aware RAG with a proof** — ACL on both legs + a leak test proving no restricted content leaks into answers. Rare, security-minded, and the most enterprise-relevant piece.
3. **Hallucination eval** — LLM-as-judge with generator ≠ judges, on an adversarial set that caught real failures. Shows I measure whether the LLM is trustworthy, not just that it responds.
4. **Real backend/infra** — BullMQ/Redis async ingestion, Postgres/Elasticsearch dual-store consistency, Prisma migrations, streaming APIs, Docker Compose + CI service containers.
5. **Local-first, no keys** — embeddings + LLMs run in-process/on Ollama; the whole thing (incl. CI eval) runs offline.

## Likely Interview Questions + Strong Answers

1. **Why hybrid instead of just vector search?**
   Vector search misranks exact tokens (error codes, IDs) and can be diluted on long docs; BM25 nails those but misses paraphrases. On my eval, keyword MRR was 0.92 and semantic 0.96; hybrid hit 0.98 and 100% R@1 on exact queries. Blending gets both strengths.

2. **How did you pick the blend weight?**
   An offline sweep over keyword weights 0.0–1.0 in the eval harness, picking the weight that maximized hybrid MRR (0.4). It's in `lib/hybrid.ts` and re-derived by `eval/harness.ts`, so prod and eval use the same ranking.

3. **How do you keep Postgres and Elasticsearch consistent?**
   Postgres is the source of truth; Elasticsearch is a derived index. The same app-generated chunk id keys both. Ingestion writes PG first, then mirrors to ES; re-index is idempotent (delete-then-write). On ACL changes, `syncDocumentAcl` updates ES in place, and `es:backfill` can rebuild ES from PG. There's no distributed transaction — it's ordered, best-effort, and reconcilable.

4. **How is permission filtering enforced, and how do you know it works?**
   Both legs independently: ES chunks carry an `acl` principal list filtered with a `terms` query; pgvector has an equivalent SQL `EXISTS` predicate. The shared retriever requires a `viewer`, so no route can skip it. `eval/acl-leak.ts` seeds a restricted doc that's the top semantic match, queries as another user, and asserts it never appears on the keyword leg, the semantic leg, or the blend — and that the generated answer doesn't contain the secret (the model refuses). 9/9.

5. **How do you measure hallucination?**
   `eval/rag-harness.ts` runs the real retriever + generator over labeled answerable/unanswerable questions, then scores per-claim faithfulness with `bespoke-minicheck` and relevance/citation with `qwen2.5`, while unanswerable questions test refusal. Generator and judges are different models to avoid self-preference. I deliberately included multi-hop and adjacent-topic distractor questions; they caught a synthesis error and a case where the model named a fact the corpus never stated.

6. **How reliable are those RAG numbers?**
   Honestly, directional. It's one run, the judges are small local models, and I wrote the fixtures. The value is the methodology and that it surfaced real failures, not the exact percentage. To firm it up I'd run it N times for a mean ± std and add a stronger judge.

7. **Why local models?**
   No API key or cost, the eval runs offline in CI, and it proves the full pipeline. `lib/embed.ts` and `lib/llm.ts` are structured as swappable seams so a hosted provider can drop in.

8. **How does ingestion handle failure?**
   Jobs run on BullMQ with `attempts: 3` and exponential backoff, only flipping to `FAILED` after retries are exhausted; the job table tracks status/errors. Re-index is idempotent, so a retried job is safe.

9. **What about XSS in highlighted snippets?**
   Elasticsearch wraps matches in sentinel tokens; the server HTML-escapes the whole snippet, then swaps sentinels for `<mark>`. Raw content can't inject markup.

10. **Is it deployed / at what scale?**
    Not deployed — it runs locally via Docker Compose, and the eval corpus is small (17 docs). I haven't load-tested it. I can talk about where I'd expect bottlenecks and how I'd benchmark them, but I won't claim numbers I didn't measure.

11. **What's the hardest bug you hit?**
    The RAG eval kept scoring all zeros — it turned out to be memory thrash: three local models (~11 GB) on an 8 GB box, and a cold-model load blowing past the client's fetch timeout. I fixed it by phasing models by residency (load → work → unload) and surfacing infra errors separately so an infra failure can't masquerade as a 0% quality score.

12. **How is the eval isolated from real data?**
    Retrieval eval runs BM25 against an ephemeral ES index and pgvector inside a rolled-back transaction, with index scans disabled for exact KNN — so it's deterministic and never pollutes either store.

13. **What would you build next?**
    Deploy with observability, a scale/latency benchmark (10k–100k docs, p50/p95/p99), a reranker + query rewriting, a group-management UI, and a unit-test suite alongside the evals.

14. **Where's the authorization enforced besides retrieval?**
    Owner-only mutations on the documents and sharing routes, delete restricted to the owner, and a viewer-scoped documents list (`documentVisibilityWhere`, the Prisma twin of the retrieval SQL predicate) so list and search share one rule.

15. **Why two judge models?**
    `bespoke-minicheck` is a purpose-built grounded-factuality checker for per-claim faithfulness; `qwen2.5` does relevance/citation scoring via constrained JSON. Splitting the job and keeping both distinct from the generator reduces bias.

## Weak Areas / Gaps (be ready)
- No deployment, no users, no scale/latency benchmarks.
- No unit/integration test framework (evals + ACL checks only).
- RAG metrics are a single local run with small judges.
- Group creation/membership is DB-only.
- Uses pretrained/off-the-shelf models (no training).

## How To Defend Metrics
- Always attach the scope: "on a labeled 27-query set," "on a 32-question LLM-judged run (local models)," "9/9 on a deterministic leak test."
- Distinguish deterministic checks (retrieval MRR in CI, ACL 9/9, sharing 8/8 — firm) from the RAG eval (directional, one run).
- Never quote the UI latency as a benchmark — call it anecdotal.
- Lead with methodology and what the eval *found* (real failures), which is more credible than a suspiciously perfect number.
