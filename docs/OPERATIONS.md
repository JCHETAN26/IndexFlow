# IndexFlow Operations

## Environments

IndexFlow expects three deployable shapes:

- `local`: `infra/docker-compose.yml` services plus `pnpm dev` and `pnpm worker`.
- `staging`: production image, seeded demo corpus, non-public OAuth credentials.
- `production`: production image, real OAuth credentials, edge rate limiting, backups.

Required runtime variables are listed in `apps/web/.env.example`. Public demo deployments should
set `DEMO_MODE=1`, `ALLOW_GUEST=1`, and a 16+ character `SEED_TOKEN`.

## Build Artifacts

The single Dockerfile builds two targets:

- web: `docker build -f infra/Dockerfile --target runner .`
- worker: `docker build -f infra/Dockerfile --target worker .`

The web and worker images must be deployed from the same commit. The worker owns ingestion,
outbox draining, and periodic reconciliation.

## Smoke Test

After deploying web and worker, run:

```bash
APP_URL=https://staging.example.com pnpm --filter @indexflow/web smoke:deploy
```

The smoke test checks:

- `/api/health` can reach Postgres.
- unauthenticated search returns a safe response.
- public document listing works.
- `/api/jobs` remains auth-gated.

## Rollback

Roll back web and worker together to the same previously deployed commit.

1. Stop new web traffic or route it to the previous web image.
2. Stop the current worker.
3. Start the previous worker image.
4. Start the previous web image.
5. Run `APP_URL=... pnpm --filter @indexflow/web smoke:deploy`.
6. Watch worker logs for outbox drain or reconciliation errors.

Database migrations in this repo are forward-only. If a migration has already run in production,
prefer rolling forward with a corrective migration rather than manually reverting schema.

## Retention

Clean old terminal jobs and completed outbox rows:

```bash
DRY_RUN=1 RETENTION_DAYS=30 pnpm --filter @indexflow/web retention:cleanup
RETENTION_DAYS=30 pnpm --filter @indexflow/web retention:cleanup
```

This does not delete documents, chunks, users, groups, or object storage.

## Usage Telemetry

Signed-in operators can read live in-process counters at:

```text
GET /api/ops/usage
```

Counters include search requests, answer requests, uploads, uploaded bytes, eval runs, and local
model token units. They reset on process restart and are not billing-grade; aggregate through OTel
or the hosting platform for production reporting.
