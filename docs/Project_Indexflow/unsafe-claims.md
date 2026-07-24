# Unsafe Claims — IndexFlow

What **not** to say about this project, why it's risky, and a truthful rewrite. The repo is a **local, single-developer portfolio project**: no deployment, no users, no scale testing.

## Unsafe Claims → Why → Safer Alternative

### 1. "Production-grade / production-deployed enterprise search"
- **Why unsafe:** Never deployed. No public URL, no infra beyond local Docker Compose, no users. README explicitly lists deployment as pending.
- **Safer:** "Production-minded local implementation of enterprise-search patterns — permission-aware retrieval, dual-store indexing, and a CI-gated quality eval."

### 2. "Enterprise-scale / handles millions of documents"
- **Why unsafe:** Quality evaluation corpus is small. Latency benchmarking exists up to 100k documents but not millions.
- **Safer:** "Benchmarked retrieval latency at 100k scale (sub-second p95)."

### 3. "Sub-second search / low latency at scale" or any p95/p99 number
- **Why unsafe:** The backend retrieval is sub-second (measured via benchmark), but local LLM generation takes ~10-20 seconds.
- **Safer:** "Retrieval latency (p95) optimized to <1s at 100k scale."

### 4. "99.x% faithfulness / near-zero hallucination"
- **Why unsafe:** One local run, judged by small local models (`bespoke-minicheck`, `qwen2.5:7b`), on a fixture set the author designed. LLM-as-judge is itself imperfect and non-deterministic.
- **Safer:** "98% faithfulness and 92% refusal correctness on a single LLM-judged run of a 32-question eval (local models); directional, not a rigorous benchmark."

### 5. "Trained / fine-tuned models"
- **Why unsafe:** No training code. Uses pretrained `all-MiniLM-L6-v2` and off-the-shelf Ollama models.
- **Safer:** "Used pretrained embeddings and local LLMs and built an evaluation harness measuring their output quality."

### 6. "Used Kubernetes / cloud (AWS/GCP/Azure) / Terraform"
- **Why unsafe:** Only Docker Compose for local infra; the S3 client points at local MinIO. No k8s, no cloud deploy, no IaC.
- **Safer:** "Containerized the stack with Docker Compose and ran CI with GitHub Actions service containers." (The AWS SDK is used to talk to MinIO locally — don't imply AWS infra.)

### 7. "Built a data pipeline with Kafka / Airflow / dbt / Spark / a warehouse"
- **Why unsafe:** None are present. Ingestion is an app-level BullMQ worker.
- **Safer:** "Built an async ingestion pipeline on Redis/BullMQ with retry/backoff and idempotent dual-store indexing."

### 8. "Multi-tenant SaaS with real users / teams"
- **Why unsafe:** No tenants, no users, no billing. Auth exists but there is no user base.
- **Safer:** "Implemented per-user access control (Auth.js + a document ACL) as the foundation for multi-tenant isolation."

### 9. "Comprehensive test coverage / TDD"
- **Why unsafe:** No unit/integration test framework (no Jest/Vitest/Playwright). Correctness is checked by eval harnesses + ACL scripts.
- **Safer:** "Verified behavior with evaluation harnesses and deterministic permission checks (leak + sharing), plus a CI quality gate; a unit-test suite is future work."

### 10. "Real-time / high-throughput ingestion"
- **Why unsafe:** No throughput measurement; the worker is single-process local.
- **Safer:** "Off-request async ingestion with retry/backoff; throughput benchmarking is future work."

### 11. "Reduced cost / drove business impact / adopted by X"
- **Why unsafe:** No business context, users, or cost data exist.
- **Safer:** Omit. There is no business-impact evidence.

## Interview Risk Notes (where the repo is weak)

- **"How does it scale?"** — Honest answer: it hasn't been scaled or benchmarked; the corpus is small. Talk about *where* the bottleneck would appear (embedding cost per query, ES vs pgvector fan-out) and how you'd measure it, rather than claiming numbers.
- **"How reliable are your RAG numbers?"** — Acknowledge: one run, small local judges, author-designed fixtures. Strength: generator ≠ judges (no self-preference), the set is deliberately adversarial (multi-hop + distractors), and it caught two real failures — that honesty is the selling point.
- **"Where are the tests?"** — There's no unit-test framework; be upfront and pivot to the eval harnesses + the deterministic ACL leak/sharing checks that drive the real code paths, plus the CI gate.
- **"Is it deployed?"** — No; local only. Don't imply otherwise. Deployment is the top roadmap item.
- **"Did you train the models?"** — No; pretrained + off-the-shelf. The engineering is the retrieval, the eval, and the permission enforcement, not the models.
- **"How is the ACL enforced end to end?"** — Strong ground: both legs independently, denormalized in ES + SQL predicate in PG, a shared retriever that *requires* a viewer, and a leak test. Be ready to explain the ES-mapping-drift edge case handled in `ensureChunkIndex`.
- **"Two stores — how do you keep them consistent?"** — Postgres is source of truth; ES is derived; shared chunk ids; `syncDocumentAcl` and `es:backfill` reconcile. Be honest that there's no distributed transaction — it's best-effort ordering with idempotent re-index.
