import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Load apps/web/.env into process.env before any test imports Prisma or the Elasticsearch client.
 *
 * Vite happens to load .env for us, but relying on that is a trap: the mechanism is invisible,
 * and a future config change would break the integration suite with a connection error that
 * looks like an infrastructure problem. Doing it explicitly costs nothing and fails loudly.
 *
 * Real environment variables always win, so CI (which sets them at the job level) is unaffected.
 */
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue; // never override the real environment
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
