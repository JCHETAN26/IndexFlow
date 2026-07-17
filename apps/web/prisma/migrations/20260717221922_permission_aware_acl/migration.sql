-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "owner_id" UUID;

-- Grandfather existing documents: they predate ownership/ACLs, so keep them
-- visible (public) rather than orphaning the current corpus. New uploads default
-- to private (is_public = false) and are visible only to their owner until shared.
UPDATE "documents" SET "is_public" = true;

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "user_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("user_id","group_id")
);

-- CreateTable
CREATE TABLE "document_grants" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "user_id" UUID,
    "group_id" UUID,

    CONSTRAINT "document_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE INDEX "group_members_group_id_idx" ON "group_members"("group_id");

-- CreateIndex
CREATE INDEX "document_grants_document_id_idx" ON "document_grants"("document_id");

-- CreateIndex
CREATE INDEX "document_grants_user_id_idx" ON "document_grants"("user_id");

-- CreateIndex
CREATE INDEX "document_grants_group_id_idx" ON "document_grants"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_grants_document_id_user_id_group_id_key" ON "document_grants"("document_id", "user_id", "group_id");

-- CreateIndex
CREATE INDEX "documents_owner_id_idx" ON "documents"("owner_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
