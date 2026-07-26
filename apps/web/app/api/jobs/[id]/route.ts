import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReadDocument, viewerFrom } from "@/lib/acl";
import { DEMO_MODE, SEED_TOKEN_HEADER, demoReadOnlyResponse, isValidSeedToken } from "@/lib/demo";
import { getIngestionQueue } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single job status — polled by the upload page until the document is indexed.
 *
 * Permission-critical: reaching a job by id reveals its document's indexing state and chunk
 * count, so it is gated on the caller being able to read that document. A job for an unreadable
 * document is indistinguishable from one that does not exist (404, never 403).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await auth();
  const userId = session?.user?.id ?? null;
  // The seed script polls this endpoint for the jobs it just created and has no browser
  // session; it presents the same shared secret it used to upload.
  const seeding = !userId && isValidSeedToken(_req.headers.get(SEED_TOKEN_HEADER));
  if (!userId && !seeding) {
    return NextResponse.json({ error: "Sign in to view ingestion jobs." }, { status: 401 });
  }

  const job = await prisma.ingestionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      error: true,
      documentId: true,
      document: { select: { status: true, _count: { select: { chunks: true } } } },
    },
  });

  if (!job || (!seeding && !(await canReadDocument(await viewerFrom(userId), job.documentId)))) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    error: job.error,
    documentStatus: job.document?.status ?? null,
    chunkCount: job.document?._count.chunks ?? 0,
  });
}

/**
 * Retry a failed ingestion job by creating a new queued job for the same document.
 *
 * Owner-only: a viewer who can read a shared document should not be able to spend the owner's
 * storage/compute budget re-indexing it. The old failed job remains as history; the UI follows
 * the newly-created job id.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (DEMO_MODE) return NextResponse.json(demoReadOnlyResponse, { status: 403 });

  const { id } = await params;
  const userId = (await auth())?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to retry ingestion jobs." }, { status: 401 });
  }

  const job = await prisma.ingestionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      documentId: true,
      document: { select: { id: true, ownerId: true, title: true, storageKey: true } },
    },
  });
  if (!job || !job.document || !(await canReadDocument(await viewerFrom(userId), job.documentId))) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.document.ownerId !== userId) {
    return NextResponse.json({ error: "Only the document owner can retry this job." }, { status: 403 });
  }
  if (job.status !== "FAILED") {
    return NextResponse.json({ error: "Only failed jobs can be retried." }, { status: 409 });
  }
  if (!job.document.storageKey) {
    return NextResponse.json({ error: "Document has no stored file to re-ingest." }, { status: 409 });
  }

  const next = await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: job.documentId },
      data: { status: "UPLOADED", indexedAt: null },
    });
    return tx.ingestionJob.create({
      data: { documentId: job.documentId, status: "QUEUED" },
      select: { id: true, status: true, createdAt: true },
    });
  });

  await getIngestionQueue().add(
    "ingest",
    { documentId: job.documentId, jobId: next.id },
    { attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true, removeOnFail: false },
  );

  return NextResponse.json({ job: next, documentId: job.documentId }, { status: 202 });
}
