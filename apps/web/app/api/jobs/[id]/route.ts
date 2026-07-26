import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canReadDocument, viewerFrom } from "@/lib/acl";
import { SEED_TOKEN_HEADER, isValidSeedToken } from "@/lib/demo";

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
