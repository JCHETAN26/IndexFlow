import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";
import { AccessError, assertCanRead, viewerFrom } from "@/lib/acl";

export const runtime = "nodejs";

/**
 * Stream the original uploaded file back from object storage.
 *
 * Permission-critical: this is a direct-object-access surface. Search and RAG filter visibility
 * inside the query, but fetching by id bypasses that entirely, so the ACL must be enforced here
 * explicitly. `middleware.ts` skips /api routes, so nothing upstream covers this.
 *
 * Unreadable documents return 404, not 403 — see assertCanRead.
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
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const doc = await prisma.document.findUnique({
    where: { id },
    select: { fileName: true, storageKey: true },
  });
  if (!doc || !doc.storageKey) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const { body, contentType } = await getObject(doc.storageKey);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${doc.fileName}"`,
    },
  });
}
