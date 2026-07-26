import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccessError, assertCanRead, viewerFrom } from "@/lib/acl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exact source-passage viewer.
 *
 * Search snippets and citation chips identify a chunk id. This route hydrates that id back to
 * the exact passage text from Postgres, after applying the same document read gate used by file
 * download. Unreadable chunks are 404s so chunk ids cannot be used to probe private documents.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const chunk = await prisma.documentChunk.findUnique({
    where: { id },
    select: {
      id: true,
      chunkIndex: true,
      content: true,
      tokenCount: true,
      documentId: true,
      document: {
        select: {
          id: true,
          title: true,
          fileName: true,
          fileType: true,
          status: true,
          aclVersion: true,
          contentVersion: true,
          uploadedAt: true,
          indexedAt: true,
          _count: { select: { chunks: true } },
        },
      },
    },
  });
  if (!chunk) return NextResponse.json({ error: "Passage not found." }, { status: 404 });

  const session = await auth();
  const viewer = await viewerFrom(session?.user?.id ?? null);
  try {
    await assertCanRead(viewer, chunk.documentId);
  } catch (e) {
    if (e instanceof AccessError) {
      return NextResponse.json({ error: "Passage not found." }, { status: e.status });
    }
    throw e;
  }

  return NextResponse.json({
    id: chunk.id,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    tokenCount: chunk.tokenCount,
    document: {
      id: chunk.document.id,
      title: chunk.document.title,
      fileName: chunk.document.fileName,
      fileType: chunk.document.fileType,
      status: chunk.document.status,
      aclVersion: chunk.document.aclVersion,
      contentVersion: chunk.document.contentVersion,
      uploadedAt: chunk.document.uploadedAt,
      indexedAt: chunk.document.indexedAt,
      chunkCount: chunk.document._count.chunks,
    },
  });
}
