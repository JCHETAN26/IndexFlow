import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { putObject, storageKeyFor } from "@/lib/storage";
import { getIngestionQueue } from "@/lib/queue";

export const runtime = "nodejs";

const ALLOWED = new Set(["md", "txt", "pdf"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export async function POST(req: NextRequest) {
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
