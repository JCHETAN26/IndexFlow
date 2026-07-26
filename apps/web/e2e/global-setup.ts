import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { ensureChunkIndex } from "../lib/es";
import { ingestDocument } from "../lib/ingest";
import { putObject, storageKeyFor } from "../lib/storage";
import {
  PRIVATE_BODY,
  PRIVATE_TITLE,
  PUBLIC_BODY,
  PUBLIC_TITLE,
} from "./fixtures";

/**
 * Seed the fixture corpus through the REAL ingest path — object storage, chunking, embedding,
 * and the outbox projector — rather than inserting rows. A shortcut here would let the suite pass
 * against a broken pipeline, which is precisely what it is supposed to catch.
 */
async function seed(opts: { title: string; body: string; isPublic: boolean; ownerId: string }) {
  const id = randomUUID();
  const key = storageKeyFor(id, "doc.txt");
  await putObject(key, Buffer.from(opts.body, "utf8"), "text/plain");
  await prisma.document.create({
    data: {
      id,
      title: opts.title,
      fileName: "doc.txt",
      fileType: "txt",
      storageKey: key,
      status: "UPLOADED",
      isPublic: opts.isPublic,
      ownerId: opts.ownerId,
    },
  });
  await ingestDocument(id);
  return id;
}

export default async function globalSetup() {
  await ensureChunkIndex();

  // The private document's owner. The browser never authenticates as this user; it exists so the
  // private document has a legitimate owner rather than being ownerless.
  const owner = await prisma.user.upsert({
    where: { email: "e2e-owner@indexflow.test" },
    update: {},
    create: { email: "e2e-owner@indexflow.test", name: "[e2e] private owner" },
    select: { id: true },
  });

  await seed({ title: PUBLIC_TITLE, body: PUBLIC_BODY, isPublic: true, ownerId: owner.id });
  await seed({ title: PRIVATE_TITLE, body: PRIVATE_BODY, isPublic: false, ownerId: owner.id });

  console.log("[e2e] fixture corpus seeded (1 public, 1 private)");
}
