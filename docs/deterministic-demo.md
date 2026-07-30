# Deterministic Demo

Use this flow for a recorded demo or a repeatable reviewer walkthrough.

## Setup

```bash
pnpm install
pnpm db:up
pnpm db:migrate
cp apps/web/.env.example apps/web/.env
```

Set `AUTH_SECRET` and a 16+ character `SEED_TOKEN` in `apps/web/.env`.

In three terminals:

```bash
pnpm dev
pnpm worker
pnpm seed
```

## Walkthrough

1. Sign in, or set `ALLOW_GUEST=1` and use guest mode.
2. Open `/`.
3. Search `ERR_QUOTA_4096`.
4. Switch between keyword, semantic, and hybrid.
5. Click `Answer`.
6. Click a citation chip, then `View exact passage`.
7. Open `/documents`, expand sharing, and share a document with a group.
8. Open `/groups`, add a user to that group.
9. Open `/jobs`, show completed indexing and retry controls for any failed job.
10. Open `/eval`, show the retrieval report and explain that generation judge calibration is
    exported with `judge:export` and scored with `judge:calibrate`.

## Claims To Narrate

- Search and answers enforce the same ACL rule on both retrieval legs.
- Source passages are hydrated by id only after the document read gate passes.
- Elasticsearch is a projection; Postgres remains the source of truth.
- Generation metrics are model-graded, and the graders were themselves audited: 40 blind human
  labels put faithfulness at 100% agreement (kappa 1.00) and exposed the citation judge as
  lenient, so citations 100% is narrated as an upper bound rather than a result.
