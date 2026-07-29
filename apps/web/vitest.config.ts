import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Two suites, deliberately separated by what they need to run:
 *
 *   unit/        pure logic, no I/O. Runs anywhere, in milliseconds, on every push.
 *   integration/ the real Postgres + Elasticsearch + MinIO. Slower, and the only place the
 *                security and cross-store properties can honestly be asserted — those bugs
 *                lived in the interaction between stores, which a mocked test cannot see.
 *
 * Select with `pnpm test:unit` / `pnpm test:integration`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: [fileURLToPath(new URL("./test/setup-env.ts", import.meta.url))],
    // Relative to `--dir`, which is how the unit and integration suites are selected.
    include: ["**/*.test.ts"],
    // Integration tests share one Postgres and one Elasticsearch index. Running files in
    // parallel makes them fight over the same rows; correctness here matters more than speed.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/prisma.ts", "lib/queue.ts"],
    },
  },
});
