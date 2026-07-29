# Container image for both the web app and the ingestion worker.
#
# One image, two entrypoints: `node apps/web/server.js` serves the app (the default), and
# `pnpm --filter @indexflow/web worker` runs the BullMQ consumer plus the outbox drainer and
# reconciler. Keeping them in one image means the two can never drift to different code, which
# matters here because they share the projection logic in lib/outbox.ts.

# ── deps ──────────────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
# Prisma needs OpenSSL to pick its query-engine binary; without it it guesses and warns.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Copy only what affects dependency resolution, so this layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/web/prisma apps/web/prisma
# The postinstall runs `prisma generate`, which needs the schema copied above.
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo
# Prisma needs OpenSSL to pick its query-engine binary; without it it guesses and warns.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma and Next want these present at build time; nothing connects during a build. ARG rather
# than ENV so no placeholder secret is baked into any image layer.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ARG AUTH_SECRET="build-only-not-a-real-secret"
RUN DATABASE_URL="$DATABASE_URL" AUTH_SECRET="$AUTH_SECRET" pnpm --filter @indexflow/web build

# ── worker ────────────────────────────────────────────────────────────────────────────────────
# A separate target rather than a second entrypoint on the web image. The worker is not part of
# the Next build, and Next's file tracing does not include its dependencies (bullmq among them),
# so the standalone bundle genuinely cannot run it. Bundling it instead was the other option, but
# its dependency graph reaches native modules (Prisma engines, onnxruntime) that do not bundle.
# This target reuses the build stage's layers, so it costs image size, not build time.
FROM build AS worker
RUN useradd --create-home --uid 10001 indexflow && chown -R indexflow:indexflow /repo
ENV NODE_ENV=production
ENV HOME=/home/indexflow
ENV TRANSFORMERS_CACHE=/home/indexflow/.cache/huggingface
USER indexflow
WORKDIR /repo/apps/web
# Invoke tsx directly rather than through `pnpm exec`: corepack would otherwise fetch pnpm from
# the npm registry on every container start, making the worker unable to boot without network
# access to npm and adding seconds to startup.
#
# Known tradeoff: this image is ~5 GB because it reuses the build stage, dev dependencies and
# all. Slimming it (a prod install plus tsx, or precompiling the worker) is worthwhile but is an
# optimisation, not a correctness fix.
CMD ["./node_modules/.bin/tsx", "worker/index.ts"]

# ── runtime ───────────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /repo
# Prisma needs OpenSSL to pick its query-engine binary; without it it guesses and warns.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run as a non-root user. The transformers cache needs a writable home.
RUN useradd --create-home --uid 10001 indexflow
ENV HOME=/home/indexflow
ENV TRANSFORMERS_CACHE=/home/indexflow/.cache/huggingface

# The standalone bundle carries its own minimal node_modules and server.js.
COPY --from=build --chown=indexflow:indexflow /repo/apps/web/.next/standalone ./
COPY --from=build --chown=indexflow:indexflow /repo/apps/web/.next/static ./apps/web/.next/static
# No apps/web/public in this project — add a COPY for it if static assets are ever introduced.

USER indexflow
EXPOSE 3000

# The worker has its own target (above); this image serves the app only.
CMD ["node", "apps/web/server.js"]
