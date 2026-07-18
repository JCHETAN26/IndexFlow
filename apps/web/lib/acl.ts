import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { updateDocumentAcl } from "@/lib/es";

/**
 * Permission model for permission-aware search. A document is visible to a viewer if
 * it is public, the viewer owns it, or a grant targets the viewer directly or via a
 * group they belong to. The same rule is enforced on both retrieval legs:
 *
 *   - Elasticsearch (keyword): each chunk carries a denormalised `acl` list of principal
 *     tokens; the query filters with `terms` on the viewer's principals (index-side).
 *   - Postgres (semantic): the same rule expressed as a SQL predicate over the ownership
 *     + grant tables (see lib/retrieve.ts).
 *
 * A principal token is one of: "public", `user:<userId>`, or `group:<groupId>`. A
 * document's tokens are the union of its visibility; a viewer's tokens are everything
 * they can act as. Visibility holds iff the two sets intersect — which is exactly the
 * `terms` filter, and mirrors the SQL EXISTS checks.
 */

export const PUBLIC = "public";
export const userToken = (userId: string) => `user:${userId}`;
export const groupToken = (groupId: string) => `group:${groupId}`;

/** Who is asking. `userId` is null for an anonymous/signed-out request (sees public only). */
export interface Viewer {
  userId: string | null;
  principals: string[]; // always includes PUBLIC
}

/**
 * Build the principal set for a viewer: "public", their own user token, and a group
 * token per group they belong to. One membership query; anonymous viewers skip it.
 */
export async function viewerFrom(userId: string | null): Promise<Viewer> {
  const principals = [PUBLIC];
  if (userId) {
    principals.push(userToken(userId));
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    for (const m of memberships) principals.push(groupToken(m.groupId));
  }
  return { userId, principals };
}

/**
 * Prisma `where` fragment selecting the documents a viewer may see — the same rule the
 * retrieval SQL predicate encodes (lib/retrieve `visibleToViewer`), expressed for the
 * Prisma query builder so the management/list surfaces stay consistent with search. An
 * anonymous viewer (null userId) sees only public documents.
 */
export function documentVisibilityWhere(viewer: Viewer): Prisma.DocumentWhereInput {
  const uid = viewer.userId;
  return {
    OR: [
      { isPublic: true },
      ...(uid
        ? [
            { ownerId: uid },
            { grants: { some: { userId: uid } } },
            { grants: { some: { group: { members: { some: { userId: uid } } } } } },
          ]
        : []),
    ],
  };
}

/** The minimal document shape needed to compute its ACL tokens for indexing. */
export interface AclDocument {
  isPublic: boolean;
  ownerId: string | null;
  grants: { userId: string | null; groupId: string | null }[];
}

/**
 * The denormalised principal tokens for a document — written into each of its ES chunks
 * so keyword search can filter at the index. Kept in sync whenever ownership/grants
 * change (ingest, and reindexDocumentAcl).
 */
export function aclTokens(doc: AclDocument): string[] {
  const tokens = new Set<string>();
  if (doc.isPublic) tokens.add(PUBLIC);
  if (doc.ownerId) tokens.add(userToken(doc.ownerId));
  for (const g of doc.grants) {
    if (g.userId) tokens.add(userToken(g.userId));
    if (g.groupId) tokens.add(groupToken(g.groupId));
  }
  return [...tokens];
}

/** Load a document's ACL tokens from Postgres (owner + public flag + grants). */
export async function documentAclTokens(documentId: string): Promise<string[]> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { isPublic: true, ownerId: true, grants: { select: { userId: true, groupId: true } } },
  });
  return doc ? aclTokens(doc) : [];
}

/**
 * Push a document's current ACL (from Postgres) into its Elasticsearch chunks. Call after
 * changing ownership, `isPublic`, or grants so the keyword index stays consistent with the
 * source of truth. `refresh` waits for the update to be searchable (used by seeds/tests).
 */
export async function syncDocumentAcl(documentId: string, refresh = false): Promise<void> {
  await updateDocumentAcl(documentId, await documentAclTokens(documentId), undefined, refresh);
}
