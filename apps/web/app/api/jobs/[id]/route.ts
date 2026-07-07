import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single job status — polled by the upload page until the document is indexed.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await prisma.ingestionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      error: true,
      document: { select: { status: true, _count: { select: { chunks: true } } } },
    },
  });

  if (!job) {
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
