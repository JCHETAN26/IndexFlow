# Project Profile — IndexFlow

## Project Name
**IndexFlow**

## One-Line Pitch
A permission-aware hybrid search engine (keyword + vector) with a grounded, citation-backed RAG layer, where retrieval quality, hallucination rate, and access control are each verified by a runnable evaluation.

## Project Category
- **AI Engineering** (primary) — RAG, hybrid retrieval, embeddings, LLM-as-judge hallucination eval, permission-aware generation
- **Full-Stack Engineering** — Next.js 15 App Router UI + API routes, React 19, auth, streaming
- **Backend Engineering** — Postgres/pgvector, Elasticsearch, Redis/BullMQ async ingestion, ACL model
- Secondary/partial: **DevOps** (Docker Compose, GitHub Actions CI with service containers)

## Problem
Two real problems, addressed together:
1. **Retrieval is a tradeoff.** Keyword search (BM25) nails exact identifiers but misses paraphrases; vector search captures meaning but misranks exact tokens. Choosing one loses the other, and picking a blend weight by intuition is guesswork.
2. **RAG is easy to build and hard to trust.** Calling an LLM over retrieved passages is trivial; knowing whether it hallucinates, and preventing it from citing content the user isn't allowed to see, is the actual engineering.

IndexFlow blends both retrieval strategies with a weight **chosen by measurement**, layers a grounded RAG answer that cites sources and refuses when unsupported, and enforces per-document access control on both retrieval legs — then proves each of these with an eval.

## Why It Matters
The project demonstrates production-minded AI/search engineering rather than a demo: it measures retrieval quality (recall@k / MRR) and hallucination rate with an LLM-as-judge harness, enforces permissions the way enterprise search actually does (denormalized ACL at the index + a SQL predicate), and gates retrieval quality in CI. The differentiators — a hallucination eval and a proven "RAG can't leak restricted content" test — are rarely present in portfolio projects.

## Target Users
- **Direct (as a product concept):** a team wanting workspace search over their own documents with per-user access control.
- **Realistically (as-is):** the author and reviewers running it locally. It is a portfolio/reference implementation, not a deployed multi-tenant product. (See Limitations.)

## Architecture Summary
A single Next.js application (UI + API routes) plus a standalone BullMQ worker. **Postgres (pgvector)** is the source of truth, the vector store, and the ACL store. **Elasticsearch** owns keyword search (BM25 + highlighting) and a denormalized ACL index. **MinIO** stores original files. **Redis** backs the ingestion queue. **Ollama** serves local LLMs (generation + judges). Chunk ids are generated in app code so one id keys a Postgres row and an Elasticsearch document, which is how hybrid ranking correlates keyword and semantic hits. Identity comes from Auth.js (Google OAuth); the viewer's principals drive an ACL filter applied on both retrieval legs.

## Main Components
- **Search API** (`apps/web/app/api/search/route.ts`) — keyword / semantic / hybrid modes, ACL-filtered.
- **Answer API** (`apps/web/app/api/answer/route.ts`) — streaming grounded RAG (NDJSON), ACL-filtered.
- **Shared retriever** (`apps/web/lib/retrieve.ts`) — the single ACL-aware retrieval path used by both search and RAG; every entry point requires a `viewer`.
- **Hybrid blend** (`apps/web/lib/hybrid.ts`) — pure min-max-normalize + weighted-sum blend.
- **Embeddings** (`apps/web/lib/embed.ts`) — in-process Transformers.js `all-MiniLM-L6-v2` (384-dim), no API key.
- **LLM layer** (`apps/web/lib/llm.ts`, `apps/web/lib/rag.ts`) — Ollama generation + LLM judges, provider-neutral seam.
- **Permissions** (`apps/web/lib/acl.ts`, `apps/web/lib/sharing.ts`) — principal model, visibility predicate, ES ACL sync, owner-only sharing mutations.
- **Async ingestion** (`apps/web/lib/ingest.ts`, `apps/web/worker/index.ts`, `apps/web/lib/queue.ts`) — extract → chunk → embed → dual-write to Postgres + Elasticsearch, on a BullMQ worker with retry/backoff.
- **Keyword index** (`apps/web/lib/es.ts`) — ES client, indexing, BM25 search with `acl` terms filter.
- **Object storage** (`apps/web/lib/storage.ts`) — MinIO (S3) for original files.
- **Auth** (`apps/web/auth.ts`, `apps/web/auth.config.ts`, `apps/web/middleware.ts`) — Auth.js (NextAuth v5) + Google.
- **Evaluation harnesses** (`apps/web/eval/`) — retrieval eval, RAG hallucination eval, ACL leak test, sharing lifecycle check.
- **UI pages** (`apps/web/app/*/page.tsx`) — search+answer, documents+sharing, eval, upload, jobs, sign-in.

## Data Flow / Request Flow
**Ingestion:** `/upload` → `POST /api/documents/upload` validates + stores the original in MinIO, records the owner, creates a `QUEUED` ingestion job, enqueues on Redis/BullMQ, returns `202`. The worker downloads from MinIO → extracts text (`.md`/`.txt`/`.pdf` via unpdf) → chunks (~180 words, 30-word overlap) → embeds (MiniLM) → writes chunks + vectors to Postgres and mirrors chunks + ACL principals to Elasticsearch.

**Search:** `GET /api/search?q=&mode=` resolves the viewer via `auth()`, fetches keyword candidates (ES BM25 + `acl` terms filter) and semantic candidates (pgvector cosine + SQL visibility predicate), blends them (`blendHybrid`), and returns ranked, highlighted results.

**Answer (RAG):** `POST /api/answer` resolves the viewer, retrieves the top-k ACL-filtered chunks, feeds them to `llama3.2:3b` under a strict grounding prompt (cite every claim, refuse if unsupported), and streams the answer + citations back as NDJSON.

## Tech Stack
- **Language:** TypeScript (strict)
- **Framework/UI:** Next.js 15 (App Router), React 19, Tailwind CSS v4
- **Data:** PostgreSQL 16 + pgvector, Elasticsearch 8, Prisma 6 (ORM + migrations)
- **Queue/cache:** Redis 7 + BullMQ
- **Object storage:** MinIO (S3-compatible), AWS SDK v3 S3 client
- **Auth:** Auth.js / NextAuth v5 + `@auth/prisma-adapter` (Google OAuth)
- **ML/AI:** Transformers.js (`all-MiniLM-L6-v2`, 384-dim) for embeddings; Ollama (`llama3.2:3b`, `qwen2.5:7b`, `bespoke-minicheck`) for generation + LLM-as-judge
- **PDF:** unpdf
- **Validation:** zod
- **Tooling:** pnpm workspace, tsx
- **Infra/CI:** Docker Compose (Postgres, Redis, Elasticsearch, MinIO), GitHub Actions (build + eval jobs with service containers)

## Core Features
- Three search modes (keyword / semantic / hybrid) with XSS-safe Elasticsearch highlighting.
- Measured hybrid blend with a weight chosen by an offline sweep (`DEFAULT_HYBRID_WEIGHT = 0.4`).
- Streaming grounded RAG answers with `[n]` citations and a refusal guardrail.
- Local LLM-as-judge hallucination eval (faithfulness / relevance / citation / refusal).
- Permission-aware search + RAG: ACL enforced independently on both retrieval legs.
- Self-serve document sharing UI (public toggle, user/group grants, revoke), scoped documents list.
- Async ingestion pipeline (BullMQ worker) with retry + backoff and a live job-status page.
- Google sign-in (Auth.js); PDF/Markdown/text ingestion.
- Live `/eval` page and CLI evals; retrieval eval gated in CI.

## What Was Actually Built
- **12 API routes** under `apps/web/app/api/` (search, answer, documents CRUD + upload + file stream + sharing, jobs, eval, eval/rag, auth).
- **6 UI pages** (`/`, `/documents`, `/eval`, `/upload`, `/jobs`, `/signin`).
- A **shared ACL-aware retriever** consumed by both the search route and the RAG orchestrator.
- A **BullMQ worker** (`worker/index.ts`) running a shared `ingestDocument` pipeline with dual-store writes.
- A **permission model** (Prisma models `Group`, `GroupMember`, `DocumentGrant`, plus `Document.ownerId`/`isPublic`) with a denormalized ES ACL and a SQL visibility predicate.
- **4 evaluation programs**: retrieval eval (`eval/harness.ts` + `eval/run.ts`), RAG hallucination eval (`eval/rag-harness.ts` + `eval/rag-run.ts`), ACL leak test (`eval/acl-leak.ts`), sharing lifecycle check (`eval/sharing-check.ts`).
- **Labeled fixtures**: `eval/corpus.json` (17 docs), `eval/queries.json` (34 queries), `eval/answers.json` (32 Q&A).
- **7 Prisma migrations** building content, identity (Auth.js), and permission tables.
- **GitHub Actions CI** with two jobs (build/type-check; eval against real Postgres + Elasticsearch service containers).
- ~6,900 lines of TypeScript/TSX in `apps/web` (excluding dependencies).

## Evidence Found
- Working code for every claimed feature (see `apps/web/lib/`, `apps/web/app/api/`).
- Runnable evals with quality gates: `apps/web/eval/harness.ts`, `rag-harness.ts`, `acl-leak.ts`, `sharing-check.ts`.
- CI config that runs the retrieval eval on real service containers: `.github/workflows/ci.yml`.
- Infra as code: `infra/docker-compose.yml` (pgvector, redis:7, elasticsearch:8.15.3, minio).
- Detailed README with architecture diagrams and three real UI screenshots (`docs/screenshots/`).
- Prisma schema + 7 migrations under `apps/web/prisma/`.

## Metrics / Results
Directly present / reproducible (all on **local, labeled fixture sets** — see `metrics.md` for confidence and framing):
- **Retrieval (17-doc / 34-query set):** hybrid **MRR 0.96** vs semantic 0.94 vs keyword 0.89; hybrid R@1 100% on exact queries. Source: `eval/harness.ts`, README, CI eval job.
- **RAG hallucination eval (32 questions), single local run:** faithfulness **98%**, answer relevance 100%, citation correctness 100%, context recall 100%, **refusal correctness 92%**. Source: `eval/rag-harness.ts`, README.
- **Permission checks:** Adversarial suite **0 leaks / 40 attempts**; sharing lifecycle check **8/8** pass. Source: `eval/adversarial-run.ts`, `eval/sharing-check.ts`.
- Retrieval improvement noted in README: keyword MRR 0.48 → 0.92 after moving from Postgres full-text to Elasticsearch BM25 (same corpus).

No production, uptime, or user metrics exist. Query latency was benchmarked in a multi-query harness up to 100k synthetic documents (`bench/latency-bench.ts`) providing robust p50/p95/p99 measurements.

## Limitations
- **Not deployed** — runs locally via Docker + `pnpm dev`; no public URL, no real users, no uptime.
- **No unit/integration test framework** (no Jest/Vitest/Playwright); correctness is checked by the eval harnesses and ACL check scripts.
- **Small evaluation corpora** (17 docs / 32 Q&A) for quality checks, though latency was tested up to 100k synthetic docs.
- **RAG metrics come from a single local run** judged by small local models (LLM-as-judge), on a fixture set the author designed — directional, not a rigorous benchmark.
- **Group creation/membership is DB-only** (no admin UI); only user + public sharing are self-serve.
- **No OCR** for image-only PDFs; upload cap 10 MB.

## Future Improvements
- Deploy to a public URL with managed Postgres/Elasticsearch; add real observability (latency, cache hit rate, eval scores over time).
- Add load/scale benchmarks (synthetic 10k–100k docs) with p50/p95/p99 for both retrieval legs.
- Add a unit/integration test suite alongside the evals.
- Group-management UI; a reranker (cross-encoder) and query rewriting/HyDE.
- Swap in larger/hosted LLMs for a stronger, more defensible RAG eval.

## Best Role Fit (0–100)
- **AI Engineer — 86.** RAG, hybrid retrieval, embeddings, LLM-as-judge hallucination measurement, permission-aware generation with a leak test. This is the project's explicit target and strongest fit. Evidence: `lib/rag.ts`, `lib/llm.ts`, `lib/retrieve.ts`, `eval/rag-harness.ts`, `eval/acl-leak.ts`.
- **Full-Stack Engineer — 82.** End-to-end Next.js 15 app: UI pages, 12 API routes, streaming, auth, sharing UI. Evidence: `app/`, `app/api/`, `auth.ts`.
- **Backend Engineer — 80.** Postgres/pgvector + Elasticsearch dual-store, Prisma schema/migrations, Redis/BullMQ worker, ACL model, NDJSON streaming. Evidence: `lib/es.ts`, `lib/ingest.ts`, `worker/`, `prisma/`.
- **DevOps Engineer — 50.** Docker Compose multi-service infra + GitHub Actions CI with service containers and a quality gate; but no real cloud deploy, IaC, or orchestration. Evidence: `infra/docker-compose.yml`, `.github/workflows/ci.yml`.
- **Machine Learning Engineer — 42.** Uses pretrained embeddings + LLMs and builds an evaluation harness, but no model training, fine-tuning, or MLOps. Evidence: `lib/embed.ts`, `eval/rag-harness.ts`.
- **Data Engineer — 42.** Real async ingestion pipeline with dual-store consistency and idempotent re-index, but no batch/stream data infra (Kafka/Airflow/dbt/Spark/warehouse). Evidence: `lib/ingest.ts`, `worker/`.
- **Analytics Engineer — 20.** No dbt/warehouse/BI/semantic layer. Not a fit.
