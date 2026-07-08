# Team Standup Notes — June 2026

## June 3

- Shipped async ingestion: uploads now return immediately and index on a background
  worker. Users no longer stare at a spinner while a large file is chunked.
- Typing latency on the mobile editor is back under 50ms after we batched block updates.

## June 12

- Moved keyword search off Postgres full-text onto Elasticsearch. Exact-match recall on
  identifiers jumped noticeably; the eval MRR for keyword-only went from 0.48 to 0.92.
- Open question: do we need a nightly reindex job, or is dual-write on ingest enough?

## June 24

- Investigated a report that "dark mode search feels broken". Root cause was the old
  full-text AND semantics dropping results when one query word didn't match. The BM25
  switch fixed it.
- Next up: PDF ingestion and a realistic demo corpus.
