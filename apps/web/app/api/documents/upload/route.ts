import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chunkText } from "@/lib/chunk";
import { embed, toVectorLiteral } from "@/lib/embed";

export const runtime = "nodejs";

const ALLOWED = new Set(["md", "txt"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file'." }, { status: 400 });
  }

  const ext = extensionOf(file.name);
  if (!ALLOWED.has(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". Allowed: .md, .txt` },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 5 MB)." },
      { status: 413 },
    );
  }

  const text = await file.text();
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return NextResponse.json(
      { error: "File contains no extractable text." },
      { status: 422 },
    );
  }

  const title = file.name.replace(/\.[^.]+$/, "");

  // Embed before writing anything, so a model failure leaves no partial document.
  const vectors = await embed(chunks.map((c) => c.content));

  // Step 1+2: synchronous ingestion inside the request. Becomes a BullMQ job in Step 6.
  // Chunks are inserted via raw SQL because the pgvector `embedding` column is an
  // Unsupported type that the Prisma client can't write directly.
  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        title,
        fileName: file.name,
        fileType: ext,
        status: "INDEXED",
        indexedAt: new Date(),
      },
      select: { id: true, title: true, fileName: true, fileType: true },
    });

    for (let i = 0; i < chunks.length; i++) {
      await tx.$executeRaw`
        INSERT INTO document_chunks (id, "documentId", "chunkIndex", content, "tokenCount", embedding, "createdAt")
        VALUES (
          gen_random_uuid(),
          ${doc.id}::uuid,
          ${chunks[i].index},
          ${chunks[i].content},
          ${chunks[i].tokenCount},
          ${toVectorLiteral(vectors[i])}::vector,
          now()
        )
      `;
    }

    return doc;
  });

  return NextResponse.json(
    { document, chunkCount: chunks.length },
    { status: 201 },
  );
}
