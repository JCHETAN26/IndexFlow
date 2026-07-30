# IndexFlow — hardening roadmap

The implementation sequence this project was built against. Each phase has an explicit **exit
criterion**, so "done" is a test result rather than a judgement call. Phases were deliberately
ordered so that security blockers landed before features, and evaluation credibility landed before
any number was published.

Canonical metrics live in [`apps/web/eval/RESULTS.md`](../apps/web/eval/RESULTS.md); this file
records what was planned and how each phase was closed out.

## Status — 2026-07-29

| Phase | Scope | Status |
|---|---|---|
| IF-0 | Security blocker | Complete |
| IF-1 | Cross-store reliability | Complete |
| IF-2 | Testing and CI | Complete |
| IF-3 | Evaluation credibility | Complete |
| IF-4 | Deployment and operations | Implemented; environment provisioning outstanding |
| IF-5 | Product completion | Complete |

**IF-3 closed on 2026-07-28** with the judge calibration run: 40 blind human labels, 90% agreement,
Cohen's κ 0.29 overall. The faithfulness judge was validated (15/15, κ 1.00); the citation judge was
found lenient, so citation correctness is now published as an upper bound rather than a result. The
retrieval re-run after the query/passage reranking fix moved `hybrid+rerank` from MRR 0.73 to 0.90.

**IF-4 is implemented** for containerisation, smoke tests, rollback docs, rate limits, retention
cleanup, usage telemetry, and basic OpenTelemetry. Staging and production provisioning remains
environment-specific and is not committed to this repository.

---

## Phase IF-0 — Security blocker

- Protect file download
- Require authentication for mutations
- Remove anonymous upload and delete behaviour
- Add central document authorisation
- Add database constraint enforcing exactly one grant principal
- Add direct-object-access security tests

**Exit:** zero unauthorised disclosures across file, search, RAG, list, and citation surfaces.

## Phase IF-1 — Cross-store reliability

- Introduce transactional outbox
- Add ACL and content versions
- Build idempotent Elasticsearch projector
- Reapply ACL during final hydration
- Add reconciliation worker
- Correct ingestion state transitions

**Exit:** forced Elasticsearch failures cannot leak revoked content or leave documents incorrectly
marked ready.

## Phase IF-2 — Testing and CI

- Vitest unit suite
- PostgreSQL / Redis / Elasticsearch / MinIO integration suite
- Playwright principal workflow
- Security regression suite
- CodeQL and dependency review
- Container build checks

**Exit:** every security and consistency failure above is represented by a test that would have
caught it.

## Phase IF-3 — Evaluation credibility

- Separate tuning and held-out test sets
- Expand corpora and queries
- Add confidence intervals
- Calibrate LLM judges against human labels
- Version datasets and configurations
- Generate one canonical metrics artefact consumed by README and UI

**Exit:** no conflicting metrics; all published figures derive from the frozen test report.

## Phase IF-4 — Deployment and operations

- Containerise web and worker
- Add staging and production environments
- Add OpenTelemetry exporter and dashboards
- Add rate limits, quotas, retention, and cost telemetry
- Add deployment smoke tests and rollback

**Exit:** a public seeded demo works without exposing unrestricted model or storage usage.

## Phase IF-5 — Product completion

- Exact source-passage viewer
- Group administration
- Source versioning and re-index history
- Failure / retry UI
- Architecture decision records
- Incident postmortem template
- Recorded deterministic demo

**Exit:** the demo can be narrated end to end without hand-waving over a broken surface.
