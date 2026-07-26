import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { putObject, storageKeyFor } from "@/lib/storage";
import { getIngestionQueue } from "@/lib/queue";
import { auth } from "@/auth";
import {
  DEMO_MODE,
  SEED_TOKEN_HEADER,
  demoReadOnlyResponse,
  getOrCreateDemoUser,
  isValidSeedToken,
} from "@/lib/demo";
import { LIMITS, callerKey, checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";

const ALLOWED = new Set(["md", "txt", "pdf"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export async function POST(req: NextRequest) {
  // Authenticate BEFORE reading the body: an unauthenticated caller must not be able to make
  // us buffer a 10 MB upload. Anonymous upload used to be allowed here and produced ownerless
  // documents, which in turn were deletable by anyone — both holes close at this check.
  const session = await auth();
  let ownerId = session?.user?.id ?? null;

  // The seed script has no browser session; it presents a shared secret instead. It is also
  // the one caller allowed to write while DEMO_MODE is on — that is how the public demo gets
  // its corpus in the first place.
  const seeding = !ownerId && isValidSeedToken(req.headers.get(SEED_TOKEN_HEADER));
  if (seeding) {
    ownerId = (await getOrCreateDemoUser()).id;
  } else if (!ownerId) {
    return NextResponse.json({ error: "Sign in to upload documents." }, { status: 401 });
  } else if (DEMO_MODE) {
    return NextResponse.json(demoReadOnlyResponse, { status: 403 });
  }

  // Writes cost storage plus a queued ingestion job. The seed script is exempt — it uploads the
  // whole corpus in one burst by design.
  if (!seeding) {
    const rl = checkRateLimit(`upload:${callerKey(req, ownerId)}`, LIMITS.upload);
    if (!rl.ok) return tooManyRequests(rl, "Upload limit reached. Please try again later.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file'." }, { status: 400 });
  }

  const ext = extensionOf(file.name);
  if (!ALLOWED.has(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". Allowed: .md, .txt, .pdf` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const title = file.name.replace(/\.[^.]+$/, "");
  const documentId = randomUUID();
  const storageKey = storageKeyFor(documentId, file.name);

  // Store the original file, then create the document + a queued ingestion job.
  // Actual indexing (chunk → embed → store) happens asynchronously in the worker.
  await putObject(storageKey, bytes, file.type || "text/plain");

  const document = await prisma.document.create({
    data: {
      id: documentId,
      title,
      fileName: file.name,
      fileType: ext,
      storageKey,
      status: "UPLOADED",
      // The uploader owns the document, and it defaults to private (owner-only) — the ownerId
      // is what makes it visible to them in permission-aware search; sharing is granted later.
      // Seeded demo-corpus documents are the exception: they are public on purpose, so a
      // signed-out visitor to the public demo has something to search.
      ownerId,
      isPublic: seeding,
    },
    select: { id: true, title: true, fileName: true, fileType: true },
  });

  const job = await prisma.ingestionJob.create({
    data: { documentId, status: "QUEUED" },
    select: { id: true },
  });

  await getIngestionQueue().add(
    "ingest",
    { documentId, jobId: job.id },
    { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true, removeOnFail: false },
  );

  return NextResponse.json(
    { document, jobId: job.id, status: "QUEUED" },
    { status: 202 },
  );
}
