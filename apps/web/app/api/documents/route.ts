import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { viewerFrom, documentVisibilityWhere } from "@/lib/acl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List the documents this viewer may see (owned, granted, or public), newest first, with
// chunk counts and — for documents the viewer owns — their current sharing state so the UI
// can render controls without a second request. Grants are only exposed to the owner.
export async function GET() {
  const session = await auth();
  const viewer = await viewerFrom(session?.user?.id ?? null);

  const docs = await prisma.document.findMany({
    where: documentVisibilityWhere(viewer),
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      title: true,
      fileName: true,
      fileType: true,
      status: true,
      uploadedAt: true,
      indexedAt: true,
      ownerId: true,
      isPublic: true,
      owner: { select: { name: true, email: true } },
      _count: { select: { chunks: true } },
      grants: {
        select: { id: true, user: { select: { email: true, name: true } }, group: { select: { name: true } } },
      },
    },
  });

  return NextResponse.json({
    documents: docs.map((d) => {
      const isOwner = !!viewer.userId && d.ownerId === viewer.userId;
      return {
        id: d.id,
        title: d.title,
        fileName: d.fileName,
        fileType: d.fileType,
        status: d.status,
        uploadedAt: d.uploadedAt,
        indexedAt: d.indexedAt,
        chunkCount: d._count.chunks,
        isPublic: d.isPublic,
        isOwner,
        // Who owns it: "you", another user's name/email, or null for a system/legacy doc.
        ownerLabel: d.ownerId ? (isOwner ? "you" : d.owner?.name ?? d.owner?.email ?? "another user") : null,
        // Owner or unowned/legacy doc → deletable here (unowned kept deletable for cleanup).
        canDelete: isOwner || d.ownerId === null,
        // Only the owner sees who a document is shared with.
        grants: isOwner
          ? d.grants.map((g) =>
              g.user
                ? { id: g.id, kind: "user" as const, label: g.user.email ?? g.user.name ?? "user" }
                : { id: g.id, kind: "group" as const, label: g.group?.name ?? "group" },
            )
          : undefined,
      };
    }),
  });
}
