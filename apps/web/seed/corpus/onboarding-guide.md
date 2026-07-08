# Engineering Onboarding

Welcome! This guide gets you from a fresh laptop to a running local stack in about an hour.

## Day one

1. Install the toolchain: Node 22, pnpm 9, and Docker.
2. Clone the monorepo and run `pnpm install`.
3. Start the local infrastructure with `pnpm db:up`. This launches Postgres, Redis,
   Elasticsearch, and MinIO as containers.
4. Apply database migrations with `pnpm db:migrate`.
5. Run the app with `pnpm dev` and the ingestion worker with `pnpm worker`.

## Where things live

- Application code and API routes are in `apps/web`.
- The ingestion worker is `apps/web/worker`.
- Retrieval evaluation lives in `apps/web/eval`.

## Getting help

Post in the #eng-help channel. If you hit a permissions error talking to the object
store, double-check your MinIO credentials in `.env` — a wrong secret key surfaces as a
403 on upload.
