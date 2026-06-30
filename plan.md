# IndexFlow — Build Plan & System Prompt

## Project Name

**IndexFlow**

## One-Line Pitch

IndexFlow is a workspace search engine that indexes PDFs, markdown files, meeting transcripts, and technical documents using hybrid keyword search and semantic retrieval.

## Simple Definition

IndexFlow helps teams search inside all their workspace files, not just page titles or plain text.

---

# 0. Build Direction (decided)

**Goal:** Learning + portfolio project targeting a software engineering role at **Notion**
(a workspace search product that judges craft and product taste). Timeline: no deadline,
learning-paced. Optimize for retrieval quality + a Notion-grade search experience, not
infrastructure breadth for its own sake.

**Chosen approach: Search-quality showcase (demo-first).**

1. Build the thinnest end-to-end slice first (Postgres + pgvector, synchronous indexing,
   no BullMQ/Elasticsearch/MinIO). Goal: type a query, get a real highlighted result.
2. Add an **evaluation harness** — a labeled query set + recall@k / MRR metrics comparing
   keyword-only vs vector-only vs hybrid. This is the centerpiece that proves the hybrid
   thesis and justifies the blend weights. *(The original plan had no evaluation — this is
   the highest-leverage addition.)*
3. Invest in Notion-grade search UX: instant results, keyboard nav, excellent highlighting,
   source badges, latency display.
4. Only then swap in the real infra (Elasticsearch for keyword + highlighting, MinIO for raw
   files, BullMQ for async indexing) as refactors of a working system, re-running the eval
   to confirm no regression.

**Definition of done for the portfolio:** a live, clickable demo where search feels like
Notion, backed by an eval page showing measured numbers (keyword-only vs vector-only vs
hybrid) with the blend weights justified by those numbers.

---

# 1. Problem

Modern workspaces contain knowledge across many file types:

* PDFs
* markdown docs
* meeting transcripts
* technical notes
* exported reports
* onboarding manuals
* API docs
* product specs

Normal keyword search is fast but misses meaning.

Vector search understands meaning but can miss exact strings like:

* error codes
* API endpoint names
* database column names
* config keys
* stack traces

IndexFlow solves this by combining both.

---

# 2. Core Idea

When a file is uploaded:

1. Store the raw file in MinIO.
2. Extract text from the file.
3. Break text into chunks.
4. Store metadata in PostgreSQL.
5. Index chunks in Elasticsearch for keyword search.
6. Store embeddings in pgvector for semantic search.
7. Blend both results into one ranked response.
8. Show highlighted snippets in a React UI.

---

# 3. Tech Stack

## Frontend

* Next.js
* TypeScript
* React
* Tailwind CSS
* shadcn/ui

## Backend

* Node.js
* TypeScript
* Express or Next.js API routes
* PostgreSQL
* Prisma
* pgvector
* Redis
* BullMQ

## Search & Storage

* Elasticsearch
* MinIO
* pgvector

## AI

* OpenAI embeddings or local embedding model
* Optional Claude API for query rewriting/summarization

---

# 4. MVP Demo

The demo should work like this:

```text
Upload PDF / Markdown / Transcript
        ↓
BullMQ ingestion job starts
        ↓
Text is extracted and chunked
        ↓
Chunks are indexed into Elasticsearch + pgvector
        ↓
User searches from React UI
        ↓
Results show title, file type, highlighted snippet, score, and source file
```

Example search:

```text
mobile editor latency
```

Result:

```text
Mobile Editor Performance Notes.pdf
Snippet: "...users reported typing latency on mobile editor sessions..."
Score: 0.91
```

---

# 5. Architecture

```text
React Upload UI
      ↓
Node.js API
      ↓
MinIO raw file storage
      ↓
BullMQ ingestion queue
      ↓
Text extractor
      ↓
Document chunker
      ↓
PostgreSQL metadata store
      ↓
Elasticsearch keyword index
      ↓
pgvector semantic index
      ↓
Hybrid search API
      ↓
React search results UI
```

---

# 6. Database Models

## documents

```sql
id UUID PRIMARY KEY
title TEXT
file_name TEXT
file_type TEXT
storage_key TEXT
status TEXT
uploaded_at TIMESTAMP
indexed_at TIMESTAMP
```

## document_chunks

```sql
id UUID PRIMARY KEY
document_id UUID REFERENCES documents(id)
chunk_index INTEGER
content TEXT
token_count INTEGER
metadata JSONB
embedding VECTOR(1536)
created_at TIMESTAMP
```

## ingestion_jobs

```sql
id UUID PRIMARY KEY
document_id UUID REFERENCES documents(id)
status TEXT
error_message TEXT
started_at TIMESTAMP
completed_at TIMESTAMP
```

## search_logs

```sql
id UUID PRIMARY KEY
query TEXT
keyword_results_count INTEGER
vector_results_count INTEGER
final_results_count INTEGER
latency_ms INTEGER
created_at TIMESTAMP
```

---

# 7. Elasticsearch Index

Index name:

```text
indexflow_chunks
```

Fields:

```json
{
  "chunk_id": "keyword",
  "document_id": "keyword",
  "title": "text",
  "file_type": "keyword",
  "content": "text",
  "metadata": "object",
  "created_at": "date"
}
```

Use Elasticsearch for:

* exact keyword matching
* phrase search
* highlighted snippets
* filters by file type
* filters by document title

---

# 8. Hybrid Ranking Logic

Search should run two queries:

## Keyword Search

Elasticsearch returns:

```text
chunk_id
document_id
highlighted snippet
keyword score
```

## Semantic Search

pgvector returns:

```text
chunk_id
document_id
cosine similarity score
```

## Final Score

Use a simple weighted blend:

```text
final_score = 0.55 * keyword_score + 0.45 * vector_score
```

Also boost:

* exact title matches
* recent documents
* matching file type filters
* chunks with both keyword and semantic match

---

# 9. API Endpoints

## Documents

```text
POST /api/documents/upload
GET /api/documents
GET /api/documents/:id
DELETE /api/documents/:id
```

## Ingestion

```text
POST /api/documents/:id/index
GET /api/jobs/:id
POST /api/demo/seed
```

## Search

```text
GET /api/search?q=mobile editor latency
GET /api/search?q=timeout error&fileType=pdf
```

Response:

```json
{
  "query": "mobile editor latency",
  "latencyMs": 118,
  "results": [
    {
      "documentId": "...",
      "chunkId": "...",
      "title": "Mobile Editor Performance Notes",
      "fileType": "pdf",
      "snippet": "...typing latency on mobile editor sessions...",
      "score": 0.91,
      "source": "hybrid"
    }
  ]
}
```

---

# 10. Frontend Pages

## `/`

Landing page with product explanation.

## `/upload`

Upload files and show ingestion status.

## `/documents`

List indexed documents.

## `/search`

Main search UI.

Should include:

* search bar
* file type filter
* result cards
* highlighted snippets
* score badge
* source badge: keyword, semantic, hybrid
* latency display

## `/jobs`

Show ingestion jobs and errors.

---

# 11. Build Sequence (demo-first)

Each step keeps the app runnable. The demo works after Step 1 and never breaks again.

## Step 1 — Thin vertical slice (Postgres-only)

* pnpm workspace + `apps/web` (Next.js, TS, Tailwind).
* `infra/docker-compose.yml` with one service: Postgres (using the `pgvector/pgvector`
  image so we don't swap it later).
* Prisma schema: `documents`, `document_chunks`.
* Upload `.md` / `.txt` → store document row → chunk synchronously in the request → store
  chunks. No queue, no object storage.
* Keyword search via Postgres full-text search (`tsvector` + `ts_rank`) with `ts_headline`
  highlighting.
* Minimal search UI: search bar + result cards with highlighted snippets.

Deliverable: upload a file, type a query, get a real highlighted result.

## Step 2 — Embeddings + pgvector semantic search

* Enable the `vector` extension; add `embedding vector(1536)` to `document_chunks`.
* Embed chunks on upload (OpenAI `text-embedding-3-small` or local model — see Open
  Questions in the design doc).
* Add cosine-similarity search returning top chunks.

Deliverable: search works even when query words don't exactly match document words.

## Step 3 — Evaluation harness (the centerpiece)

* Hand-label 15–30 queries against the seed corpus (which chunk is the correct answer).
* Script computes recall@k and MRR for keyword-only, vector-only, and hybrid.
* Use it to choose the blend weights (replace the guessed `0.55 / 0.45`).

Deliverable: `pnpm eval` prints measured numbers per strategy.

## Step 4 — Hybrid blend + eval page

* Blend keyword + vector scores; boost exact title matches and chunks matching both.
* `/eval` UI page comparing the three strategies side by side on a query, with scores and
  metric deltas.

Deliverable: a visual, defensible comparison of keyword vs vector vs hybrid.

## Step 5 — Notion-grade search UX

* Instant search, keyboard navigation (↑/↓/enter), excellent highlighting, file-type
  filter, source badge (keyword / semantic / hybrid), latency display, empty/loading/error
  states.

Deliverable: search that feels like Notion.

## Step 6 — Swap in real infra (refactor of working system)

* Move keyword search to Elasticsearch (better highlighting + filters).
* Move raw files to MinIO.
* Move indexing to a BullMQ worker (`apps/api`).
* Re-run the eval after each swap to confirm no regression.

Deliverable: the real architecture, proven equivalent or better by the eval.

## Step 7 — PDF support + realistic seed + deploy

* Add PDF text extraction.
* Seed a realistic mixed-format corpus that flows through the real pipeline.
* Deploy to a live URL (Vercel for web; managed host/Fly.io for API + Postgres/pgvector).
* README leading with the eval result and a search GIF — not a list of technologies.

---



# 12. Claude Code System Prompt

Use this prompt when building IndexFlow.

```text
You are building IndexFlow, a workspace search engine for deep file attachments.

The product goal:
Build a full-stack search system that lets users upload PDFs, markdown files, text files, and meeting transcripts, then search across their content using hybrid retrieval.

Core stack:
- Next.js
- TypeScript
- React
- Tailwind CSS
- Node.js
- PostgreSQL
- Prisma
- pgvector
- Elasticsearch
- Redis
- BullMQ
- MinIO

Core workflow:
1. User uploads a file from the frontend.
2. Backend stores the raw file in MinIO.
3. Backend creates a document record in PostgreSQL.
4. BullMQ ingestion worker extracts text.
5. Worker chunks text into searchable sections.
6. Worker creates embeddings.
7. Worker stores chunks and embeddings in PostgreSQL + pgvector.
8. Worker indexes chunks into Elasticsearch.
9. User searches from the frontend.
10. Search API queries Elasticsearch and pgvector.
11. Search API blends results into one ranked list.
12. React UI displays highlighted snippets, file type, score, source, and latency.

Important rules:
- Do not build a generic CRUD app.
- The search experience is the product.
- Prioritize the end-to-end demo before adding extra features.
- Keep every boundary typed with TypeScript and Zod.
- Use BullMQ for all long-running ingestion work.
- Store raw files in MinIO, not local disk.
- Store document metadata in PostgreSQL.
- Use Elasticsearch for keyword search and snippets.
- Use pgvector for semantic search.
- Log search latency and result counts.
- The UI should feel clean, fast, and technical.
- Avoid fake hardcoded search results.
- Seed data is allowed, but it must flow through the real indexing pipeline.

Build order:
1. Repo setup
2. Docker Compose for Postgres, Redis, Elasticsearch, MinIO
3. File upload API
4. MinIO storage service
5. Document metadata model
6. BullMQ ingestion worker
7. Text extraction
8. Chunking
9. Elasticsearch indexing
10. pgvector embeddings
11. Keyword search API
12. Semantic search API
13. Hybrid search API
14. React search UI
15. Demo seed script
16. README, screenshots, and demo video notes

Definition of done:
A user can upload files, wait for indexing, search a query, and see ranked results with highlighted snippets pulled from real indexed file content.
```
