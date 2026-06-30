# IndexFlow

Hybrid workspace search — keyword + semantic retrieval over your files.

Vector search understands meaning but misses exact strings (error codes, API names,
config keys). Keyword search nails exact strings but misses meaning. IndexFlow blends
both into one ranked result list with highlighted snippets.

> Status: **Step 4 — hybrid search.** Upload `.md`/`.txt`, chunk + embed + index
> synchronously, and search in three modes: **keyword** (Postgres full-text, highlighted
> snippets), **semantic** (pgvector cosine over local embeddings), and **hybrid** (a
> measured blend of both). A live evaluation page (`/eval`) scores all three. The real
> infra (Elasticsearch, MinIO, BullMQ) lands in later steps. See [`plan.md`](./plan.md).

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

Then open `/upload` to index a file and `/` to search it. Toggle **Keyword**,
**Semantic**, or **Hybrid** on the search page, and open `/eval` to run the retrieval
benchmark in the browser.

The first embedding call downloads the model (~25 MB) once, then runs in-process.
To embed documents indexed before embeddings existed:

```bash
pnpm --filter @indexflow/web embed:backfill
```

## Evaluation

Retrieval quality is measured, not guessed. A labeled query set
(`apps/web/eval/`) is scored for recall@k and MRR against keyword and semantic search:

```bash
pnpm --filter @indexflow/web eval
```

The runner seeds a fixture corpus inside a rolled-back transaction (it never touches
your data) and prints a comparison table, a hybrid weight sweep, and a pass/fail quality
gate. The same harness backs the `/eval` page. CI runs it on every PR, so "green" means
retrieval didn't regress.

Current numbers (MRR): keyword 0.48, semantic 0.96, **hybrid 0.98**. Keyword is brittle
because `plainto_tsquery` ANDs terms; semantic handles paraphrases but can misrank an
exact identifier when a doc's embedding is diluted (e.g. a long error-code reference) —
hybrid fixes both. The blend weight (0.5) is chosen by the sweep, not guessed.

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
