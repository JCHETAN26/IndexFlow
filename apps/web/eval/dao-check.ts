/**
 * Direct object access — the check that `acl:leak` structurally cannot make.
 *
 * The leak test proves the RETRIEVAL path filters by permission. But retrieval filters inside
 * the query; anything that reaches a document by id instead has no such filter and needs its own
 * gate. That gap was real: GET /api/documents/[id]/file streamed any document's original bytes to
 * any anonymous caller who knew (or guessed) a UUID, and DELETE let anyone remove an ownerless
 * document. Both are fixed; this script exists so they cannot silently come back.
 *
 * Two layers, because they fail in different ways:
 *   1. The gate itself — `canReadDocument` (lib/acl), the shared helper every by-id surface calls.
 *      Always runs.
 *   2. The live HTTP surface — the anonymous case against a running dev server, which is the one
 *      an attacker can actually reach with no credentials. Skipped (loudly) if no server is up.
 *      Signed-in cases are not reachable over HTTP without an OAuth session, so they are covered
 *      at layer 1.
 *
 * Everything it creates is torn down in a finally block. Exits non-zero on any failure.
 * Run: pnpm --filter @indexflow/web acl:dao   (BASE_URL overrides the target; default :3000)
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { canReadDocument, viewerFrom } from "../lib/acl";

const TAG = "[dao-check]";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;
function check(pass: boolean, label: string) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}

async function main() {
  const stamp = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { email: `dao-owner-${stamp}@example.test`, name: `${TAG} owner` },
    select: { id: true },
  });
  const other = await prisma.user.create({
    data: { email: `dao-other-${stamp}@example.test`, name: `${TAG} other` },
    select: { id: true },
  });

  // A private document owned by `owner`, and a public one as the positive control.
  const priv = await prisma.document.create({
    data: {
      title: `${TAG} private`,
      fileName: "private.md",
      fileType: "md",
      status: "INDEXED",
      indexedAt: new Date(),
      isPublic: false,
      ownerId: owner.id,
      storageKey: `dao-check/${stamp}/private.md`,
    },
    select: { id: true },
  });
  const pub = await prisma.document.create({
    data: {
      title: `${TAG} public`,
      fileName: "public.md",
      fileType: "md",
      status: "INDEXED",
      indexedAt: new Date(),
      isPublic: true,
      ownerId: owner.id,
      storageKey: `dao-check/${stamp}/public.md`,
    },
    select: { id: true },
  });

  try {
    // ── Layer 1: the authorization gate ──
    console.log(`\n${TAG} read gate (lib/acl canReadDocument)`);
    console.log("─".repeat(60));

    const anon = await viewerFrom(null);
    const vOwner = await viewerFrom(owner.id);
    const vOther = await viewerFrom(other.id);

    check(!(await canReadDocument(anon, priv.id)), "anonymous CANNOT read a private document");
    check(!(await canReadDocument(vOther, priv.id)), "non-owner CANNOT read a private document");
    check(await canReadDocument(vOwner, priv.id), "owner CAN read it [positive control]");
    check(await canReadDocument(anon, pub.id), "anonymous CAN read a public document [positive control]");

    // A grant must actually open access — otherwise the checks above could pass by the gate
    // simply refusing everyone.
    const grant = await prisma.documentGrant.create({
      data: { documentId: priv.id, userId: other.id },
      select: { id: true },
    });
    check(await canReadDocument(vOther, priv.id), "after a direct grant, the grantee CAN read it");
    await prisma.documentGrant.delete({ where: { id: grant.id } });
    check(!(await canReadDocument(vOther, priv.id)), "after revoking the grant, they CANNOT again");

    // ── Layer 2: the live HTTP surface, unauthenticated ──
    console.log(`\n${TAG} live HTTP surface (anonymous, ${BASE_URL})`);
    console.log("─".repeat(60));

    let serverUp = true;
    try {
      await fetch(`${BASE_URL}/api/documents`, { signal: AbortSignal.timeout(3000) });
    } catch {
      serverUp = false;
    }

    if (!serverUp) {
      console.log(`  SKIP  no server reachable at ${BASE_URL} — run \`pnpm dev\` to include these`);
      console.log("        (the gate above is still fully checked)");
    } else {
      const fileRes = await fetch(`${BASE_URL}/api/documents/${priv.id}/file`);
      check(
        fileRes.status === 404,
        `GET /api/documents/<private>/file anonymously → 404 (got ${fileRes.status})`,
      );

      const delRes = await fetch(`${BASE_URL}/api/documents/${priv.id}`, { method: "DELETE" });
      check(
        delRes.status === 401,
        `DELETE /api/documents/<private> anonymously → 401 (got ${delRes.status})`,
      );

      const upRes = await fetch(`${BASE_URL}/api/documents/upload`, {
        method: "POST",
        body: (() => {
          const f = new FormData();
          f.append("file", new Blob(["should never be indexed"], { type: "text/plain" }), "dao.txt");
          return f;
        })(),
      });
      check(
        upRes.status === 401,
        `POST /api/documents/upload anonymously → 401 (got ${upRes.status})`,
      );

      // The document must still exist: a failed DELETE that actually deleted would be worse
      // than a wrong status code.
      const stillThere = await prisma.document.findUnique({ where: { id: priv.id }, select: { id: true } });
      check(stillThere !== null, "the private document survived the anonymous DELETE attempt");
    }
  } finally {
    await prisma.document.deleteMany({ where: { id: { in: [priv.id, pub.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } }).catch(() => {});
  }

  console.log("─".repeat(60));
  if (failures === 0) {
    console.log("No direct-object-access holes. ✓");
  } else {
    console.error(`${failures} direct-object-access failure(s). ✗`);
    process.exitCode = 1;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
