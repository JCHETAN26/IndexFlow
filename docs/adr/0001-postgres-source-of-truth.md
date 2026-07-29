# ADR 0001: Postgres Is The Source Of Truth

## Status

Accepted.

## Context

IndexFlow stores searchable content in both Postgres and Elasticsearch. Earlier versions wrote
directly to Elasticsearch during ingest and ACL changes, which made permission revokes race with
slow embedding work and allowed the two stores to disagree.

## Decision

Postgres is the source of truth. Elasticsearch is a projection maintained through a transactional
outbox. Outbox events carry no payload; the projector re-reads current Postgres state, including
the latest ACL and content versions, before writing chunks.

## Consequences

- Retries are idempotent.
- Revokes cannot be overwritten by stale indexing snapshots.
- A document is marked `INDEXED` only after the projection is present.
- Reconciliation can detect and repair drift by comparing Postgres and Elasticsearch state.
