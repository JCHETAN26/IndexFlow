import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { deleteObject } from "@/lib/storage";
import { deleteDocumentChunks } from "@/lib/es";

export const runtime = "nodejs";

// Delete a document, its stored file, and its chunks (chunks cascade via the schema).
// Permission-aware: only the owner may delete an owned document; unowned/legacy documents
// (no owner) stay deletable by any signed-in user so seed data can be cleaned up.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const doc = await prisma.document.findUnique({
      where: { id },
      select: { storageKey: true, ownerId: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const userId = (await auth())?.user?.id ?? null;
    if (doc.ownerId && doc.ownerId !== userId) {
      return NextResponse.json({ error: "Only the owner can delete this document." }, { status: 403 });
    }

    if (doc.storageKey) {
      // Best-effort: don't block deletion of the record if the object is already gone.
      await deleteObject(doc.storageKey).catch(() => {});
    }
    // Best-effort: remove the document's chunks from the ES keyword index too.
    await deleteDocumentChunks(id, undefined, true).catch(() => {});
    await prisma.document.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    throw e;
  }
}
