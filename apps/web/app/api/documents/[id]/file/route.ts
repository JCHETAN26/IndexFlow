import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";

export const runtime = "nodejs";

// Stream the original uploaded file back from object storage.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
