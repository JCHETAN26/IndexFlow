import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List recent ingestion jobs with their document + chunk count.
export async function GET() {
  const jobs = await prisma.ingestionJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      error: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      document: {
        select: { id: true, title: true, fileName: true, fileType: true, _count: { select: { chunks: true } } },
      },
    },
  });

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      error: j.error,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      document: j.document && {
        id: j.document.id,
        title: j.document.title,
        fileName: j.document.fileName,
        fileType: j.document.fileType,
        chunkCount: j.document._count.chunks,
      },
    })),
  });
}
