import { prisma } from "../lib/prisma";
import { deleteDocumentChunks } from "../lib/es";
import { E2E_TAG } from "./fixtures";

/** Remove everything global-setup created, from both stores. */
export default async function globalTeardown() {
  const docs = await prisma.document.findMany({
    where: { title: { startsWith: E2E_TAG } },
    select: { id: true },
  });

  for (const d of docs) {
    await deleteDocumentChunks(d.id, undefined, true).catch(() => {});
    await prisma.document.delete({ where: { id: d.id } }).catch(() => {});
  }
  await prisma.outboxEvent
    .deleteMany({ where: { documentId: { in: docs.map((d) => d.id) } } })
    .catch(() => {});
  await prisma.user.deleteMany({ where: { email: "e2e-owner@indexflow.test" } }).catch(() => {});

  console.log(`[e2e] torn down ${docs.length} fixture document(s)`);
  await prisma.$disconnect();
}
