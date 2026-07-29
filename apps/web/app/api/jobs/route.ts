import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { documentVisibilityWhere, viewerFrom } from "@/lib/acl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List recent ingestion jobs with their document + chunk count.
 *
 * Permission-critical: this is a LIST surface that echoes document titles and file names, so it
 * needs the same ACL as /api/documents. It previously had no auth at all and returned the 50 most
 * recent jobs across every document, which disclosed the titles and file names of other people's
 * private uploads to anonymous callers.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view ingestion jobs." }, { status: 401 });
  }
  const viewer = await viewerFrom(userId);

  const jobs = await prisma.ingestionJob.findMany({
    // Same visibility rule as the document list — one rule, one place (lib/acl).
    where: { document: documentVisibilityWhere(viewer) },
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
