# IndexFlow

Hybrid workspace search — keyword + semantic retrieval over your files.

Vector search understands meaning but misses exact strings (error codes, API names,
config keys). Keyword search nails exact strings but misses meaning. IndexFlow blends
both into one ranked result list with highlighted snippets.

> Status: **Step 2 — semantic search.** Upload `.md`/`.txt`, chunk + embed + index
> synchronously, and search in two modes: **keyword** (Postgres full-text, highlighted
> snippets) and **semantic** (pgvector cosine similarity over local embeddings). An
> evaluation harness, hybrid ranking, and the real infra (Elasticsearch, MinIO, BullMQ)
> land in later steps. See [`plan.md`](./plan.md).

## Stack (current)

- Next.js 15 + React 19 + TypeScript + Tailwind v4 (`apps/web`)
- PostgreSQL 16 + `pgvector` (full-text **and** vector search)
- Local embeddings: `all-MiniLM-L6-v2` (384-dim) via Transformers.js — no API key,
  runs in-process
- Prisma ORM

## Quick start

```bash
pnpm install
pnpm db:up          # start Postgres (docker, port 5440)
pnpm db:migrate     # apply Prisma migrations
pnpm dev            # http://localhost:3000
```

Then open `/upload` to index a file and `/` to search it. Toggle **Keyword** vs
**Semantic** on the search page.

The first embedding call downloads the model (~25 MB) once, then runs in-process.
To embed documents indexed before embeddings existed:

```bash
pnpm --filter @indexflow/web embed:backfill
```

## Development workflow

`main` is protected. All changes go through a pull request and must pass CI (`build`,
which installs, generates the Prisma client, and type-checks via `next build`) before
merging.

## Layout

```
apps/web            Next.js app (UI + API routes)
infra               docker-compose (Postgres/pgvector)
plan.md             Build plan and direction
```
