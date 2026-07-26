import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AccessError, assertCanRead, viewerFrom } from "@/lib/acl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Source versioning and re-index history.
 *
 * The current schema tracks monotonic content/ACL projection versions on Document and keeps
 * ingestion jobs plus outbox attempts. This endpoint exposes that history in one place so the UI
 * and operators can see whether a source was re-indexed, whether ACL changes were projected, and
 * whether repair work is still pending.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const viewer = await viewerFrom(session?.user?.id ?? null);

  try {
    await assertCanRead(viewer, id);
  } catch (e) {
    if (e instanceof AccessError) {
      return NextResponse.json({ error: "Document not found." }, { status: e.status });
    }
    throw e;
  }

  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      fileName: true,
      status: true,
      aclVersion: true,
      contentVersion: true,
      uploadedAt: true,
      indexedAt: true,
      _count: { select: { chunks: true } },
      jobs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          error: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const outbox = await prisma.outboxEvent.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      reason: true,
      status: true,
      attempts: true,
      lastError: true,
      createdAt: true,
      processedAt: true,
    },
  });

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      fileName: doc.fileName,
      status: doc.status,
      aclVersion: doc.aclVersion,
      contentVersion: doc.contentVersion,
      uploadedAt: doc.uploadedAt,
      indexedAt: doc.indexedAt,
      chunkCount: doc._count.chunks,
    },
    jobs: doc.jobs,
    projections: outbox,
  });
}
