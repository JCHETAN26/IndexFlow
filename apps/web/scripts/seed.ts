/**
 * Seed the demo corpus through the REAL pipeline: each file in seed/corpus is uploaded to
 * POST /api/documents/upload exactly like a user would, so it flows MinIO → BullMQ worker
 * → Postgres + Elasticsearch. No shortcuts, no hardcoded rows.
 *
 * Requires the app AND the worker to be running. Re-runnable: files whose fileName is
 * already indexed are skipped.
 *
 * Run: pnpm --filter @indexflow/web seed   (BASE_URL overrides the target; default :3000)
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "seed", "corpus");

const MIME: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
};

interface JobRef {
  fileName: string;
  jobId: string;
}

async function existingFileNames(): Promise<Set<string>> {
  const res = await fetch(`${BASE_URL}/api/documents`);
  if (!res.ok) throw new Error(`GET /api/documents failed (${res.status}) — is the app running?`);
  const { documents } = (await res.json()) as { documents: { fileName: string }[] };
  return new Set(documents.map((d) => d.fileName));
}

async function upload(fileName: string, bytes: Buffer): Promise<string> {
  const ext = fileName.split(".").pop()!.toLowerCase();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: MIME[ext] ?? "application/octet-stream" }), fileName);
  const res = await fetch(`${BASE_URL}/api/documents/upload`, { method: "POST", body: form });
  if (res.status !== 202) {
    throw new Error(`upload ${fileName} failed (${res.status}): ${await res.text()}`);
  }
  return ((await res.json()) as { jobId: string }).jobId;
}

async function waitForJob(jobId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
    if (res.ok) {
      const { status, error } = (await res.json()) as { status: string; error: string | null };
      if (status === "COMPLETED") return status;
      if (status === "FAILED") throw new Error(`job ${jobId} failed: ${error ?? "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms`);
}

async function main() {
  const files = (await readdir(CORPUS_DIR)).filter((f) => /\.(md|txt|pdf)$/i.test(f)).sort();
  if (files.length === 0) {
    console.log("No seed files found in seed/corpus. Nothing to do.");
    return;
  }

  const existing = await existingFileNames();
  const jobs: JobRef[] = [];

  console.log(`Seeding ${files.length} file(s) via ${BASE_URL} …`);
  for (const fileName of files) {
    if (existing.has(fileName)) {
      console.log(`  skip   ${fileName} (already indexed)`);
      continue;
    }
    const bytes = await readFile(join(CORPUS_DIR, fileName));
    const jobId = await upload(fileName, bytes);
    jobs.push({ fileName, jobId });
    console.log(`  upload ${fileName} → job ${jobId}`);
  }

  if (jobs.length === 0) {
    console.log("Everything already indexed. ✓");
    return;
  }

  console.log(`Waiting for ${jobs.length} ingestion job(s) to finish (needs the worker running) …`);
  for (const { fileName, jobId } of jobs) {
    await waitForJob(jobId);
    console.log(`  indexed ${fileName} ✓`);
  }
  console.log("Done. ✓");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
