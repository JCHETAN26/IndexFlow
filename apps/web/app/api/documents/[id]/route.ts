import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { deleteObject } from "@/lib/storage";
import { canReadDocument, viewerFrom } from "@/lib/acl";
import { enqueueProjection, projectNow } from "@/lib/outbox";
import { DEMO_MODE, demoReadOnlyResponse } from "@/lib/demo";

export const runtime = "nodejs";

// Delete a document, its stored file, and its chunks (chunks cascade via the schema).
//
// Permission-aware: sign-in required, and only the owner may delete. The previous rule made an
// exception for ownerless documents ("so seed data can be cleaned up"), which combined with
// anonymous upload meant ANY caller could delete them. Uploads are now always owned, so the
// exception has no legitimate users left; ownerless legacy rows are admin/DB cleanup.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const userId = (await auth())?.user?.id ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Sign in to delete documents." }, { status: 401 });
    }
    if (DEMO_MODE) {
      return NextResponse.json(demoReadOnlyResponse, { status: 403 });
    }

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { storageKey: true, ownerId: true },
    });
    // Don't confirm a document exists to someone who cannot even read it: 404, not 403.
    if (!doc || !(await canReadDocument(await viewerFrom(userId), id))) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    if (doc.ownerId !== userId) {
      return NextResponse.json({ error: "Only the owner can delete this document." }, { status: 403 });
    }

    if (doc.storageKey) {
      // Best-effort: don't block deletion of the record if the object is already gone.
      await deleteObject(doc.storageKey).catch(() => {});
    }

    // Delete the row and record that Elasticsearch owes a removal, in one transaction. The
    // outbox row has no foreign key precisely so it survives the document it refers to — a
    // best-effort ES delete before the commit could silently leave the chunks (and therefore
    // the content) searchable after the document was gone.
    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id } });
      await enqueueProjection(tx, id, "document:delete");
    });
    await projectNow(id);

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    throw e;
  }
}
