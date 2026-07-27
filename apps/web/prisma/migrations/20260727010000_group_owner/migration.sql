-- Give groups an owner, so "who may change this group's membership?" has an answer.
--
-- Group administration shipped without one. The membership endpoints checked only that the caller
-- was signed in, so any authenticated user could add themselves to any group — and because a
-- viewer's principals include a `group:<id>` token for every group they belong to (lib/acl), that
-- immediately granted read access to every document shared with it. A complete bypass of
-- group-based sharing, reproduced end to end before this migration.
--
-- Nullable on purpose. Groups that predate this column have no owner, and the application treats
-- an ownerless group as unmanageable: nobody can add or remove members. That fails CLOSED. The
-- alternative — guessing an owner, e.g. the first member — would hand somebody administrative
-- control over a group they were merely added to, which is the same mistake in a smaller costume.
-- Ownerless groups are adopted deliberately, by an operator setting owner_id directly.
ALTER TABLE "groups" ADD COLUMN "owner_id" UUID;

ALTER TABLE "groups"
  ADD CONSTRAINT "groups_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "groups_owner_id_idx" ON "groups" ("owner_id");
