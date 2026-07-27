import { prisma } from "@/lib/prisma";
import { AccessError } from "@/lib/acl";

/**
 * Group administration authorization.
 *
 * Membership is not an administrative detail — it is an access-control decision. A viewer's
 * principals include a `group:<id>` token for every group they belong to (lib/acl `viewerFrom`),
 * so adding a user to a group grants them read access to every document shared with it. The
 * endpoints originally required only a signed-in caller, which made that self-service: any user
 * could add themselves to any group and read its documents.
 *
 * Everything here is deliberately in one place so the add and remove paths cannot drift apart.
 */

/** Groups the caller is entitled to see: ones they own, plus ones they belong to. */
export function visibleGroupsWhere(userId: string) {
  return {
    OR: [{ ownerId: userId }, { members: { some: { userId } } }],
  };
}

/**
 * Assert the caller may change this group's membership. Only the owner may.
 *
 * An ownerless group (created before groups had owners) is unmanageable by anyone — deliberately.
 * Inferring an owner, say the first member, would hand administrative control to someone who was
 * merely added, which is the same privilege-escalation shape in a smaller costume. Adoption is an
 * operator action: set `owner_id` directly.
 *
 * Throws 404 rather than 403 when the caller cannot even see the group, so group ids cannot be
 * probed for existence — the same rule the document read gate follows.
 */
export async function assertCanAdministerGroup(groupId: string, userId: string): Promise<void> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, ownerId: true, members: { where: { userId }, select: { userId: true } } },
  });

  if (!group) throw new AccessError(404, "Group not found.");

  const isOwner = group.ownerId === userId;
  const isMember = group.members.length > 0;

  // Not the owner and not even a member → do not confirm the group exists.
  if (!isOwner && !isMember) throw new AccessError(404, "Group not found.");

  // Order matters: an ownerless group also fails `isOwner`, so it must be reported first or the
  // caller gets a misleading "only the owner can do this" for a group that has no owner at all.
  if (group.ownerId === null) {
    throw new AccessError(
      403,
      "This group has no owner and cannot be modified. An administrator must set one directly.",
    );
  }
  if (!isOwner) {
    throw new AccessError(403, "Only the group owner can change its membership.");
  }
}
