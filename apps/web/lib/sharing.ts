import { prisma } from "@/lib/prisma";
import { syncDocumentAcl } from "@/lib/acl";

/**
 * Document sharing: the owner-only mutations behind the /documents sharing UI. Every
 * change to visibility (public flag) or grants re-syncs the document's denormalised ACL
 * into Elasticsearch (syncDocumentAcl) so keyword search stays consistent with Postgres —
 * i.e. sharing a document immediately makes it retrievable to the new principal, and
 * un-sharing immediately hides it, on both retrieval legs.
 *
 * Authorisation lives in the route (assertOwner); these functions assume it has passed.
 */

/** A carrier for the HTTP status a failed sharing operation should map to. */
export class SharingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SharingError";
  }
}

export interface GrantView {
  id: string;
  kind: "user" | "group";
  label: string; // user email/name, or group name
}
export interface SharingView {
  isPublic: boolean;
  ownerId: string | null;
  grants: GrantView[];
}

/** Throw unless `userId` is the document's owner (404 if the document doesn't exist). */
export async function assertOwner(documentId: string, userId: string | null): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } });
  if (!doc) throw new SharingError(404, "Document not found.");
  if (!userId || doc.ownerId !== userId) {
    throw new SharingError(403, "Only the document owner can change its sharing.");
  }
}

const toGrantView = (g: {
  id: string;
  user: { email: string | null; name: string | null } | null;
  group: { name: string } | null;
}): GrantView =>
  g.user
    ? { id: g.id, kind: "user", label: g.user.email ?? g.user.name ?? "user" }
    : { id: g.id, kind: "group", label: g.group?.name ?? "group" };

/** Current sharing state of a document (public flag + explicit grants). */
export async function getSharing(documentId: string): Promise<SharingView> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      isPublic: true,
      ownerId: true,
      grants: {
        select: { id: true, user: { select: { email: true, name: true } }, group: { select: { name: true } } },
      },
    },
  });
  if (!doc) throw new SharingError(404, "Document not found.");
  return { isPublic: doc.isPublic, ownerId: doc.ownerId, grants: doc.grants.map(toGrantView) };
}

/** Toggle the document's org-wide public visibility, then re-sync its ES ACL. */
export async function setPublic(documentId: string, isPublic: boolean): Promise<SharingView> {
  await prisma.document.update({ where: { id: documentId }, data: { isPublic } });
  await syncDocumentAcl(documentId, true);
  return getSharing(documentId);
}

/** Grant access to one principal — a user (by email) or a group (by name) — then re-sync. */
export async function addGrant(
  documentId: string,
  input: { email?: string; groupName?: string },
): Promise<SharingView> {
  let userId: string | undefined;
  let groupId: string | undefined;

  const email = input.email?.trim();
  const groupName = input.groupName?.trim();
  if (email) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new SharingError(404, `No user with email "${email}" (they must sign in at least once first).`);
    userId = user.id;
  } else if (groupName) {
    const group = await prisma.group.findUnique({ where: { name: groupName }, select: { id: true } });
    if (!group) throw new SharingError(404, `No group named "${groupName}".`);
    groupId = group.id;
  } else {
    throw new SharingError(400, "Provide a user email or a group name to share with.");
  }

  const existing = await prisma.documentGrant.findFirst({
    where: { documentId, userId: userId ?? null, groupId: groupId ?? null },
    select: { id: true },
  });
  if (existing) throw new SharingError(409, "Already shared with that principal.");

  await prisma.documentGrant.create({ data: { documentId, userId, groupId } });
  await syncDocumentAcl(documentId, true);
  return getSharing(documentId);
}

/** Revoke a specific grant on a document, then re-sync its ES ACL. */
export async function removeGrant(documentId: string, grantId: string): Promise<SharingView> {
  const grant = await prisma.documentGrant.findUnique({ where: { id: grantId }, select: { documentId: true } });
  if (!grant || grant.documentId !== documentId) throw new SharingError(404, "Grant not found on this document.");
  await prisma.documentGrant.delete({ where: { id: grantId } });
  await syncDocumentAcl(documentId, true);
  return getSharing(documentId);
}
