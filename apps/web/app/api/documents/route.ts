import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List indexed documents, newest first, with chunk counts.
export async function GET() {
  const docs = await prisma.document.findMany({
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      title: true,
      fileName: true,
      fileType: true,
      status: true,
      uploadedAt: true,
      indexedAt: true,
      _count: { select: { chunks: true } },
    },
  });

  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      fileType: d.fileType,
      status: d.status,
      uploadedAt: d.uploadedAt,
      indexedAt: d.indexedAt,
      chunkCount: d._count.chunks,
    })),
  });
}
