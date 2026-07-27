import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  AccessError,
  canReadDocument,
  documentVisibilityWhere,
  syncDocumentAcl,
  viewerFrom,
  type Viewer,
} from "@/lib/acl";
import {
  countDocumentChunks,
  deleteDocumentChunks,
  ensureChunkIndex,
  getProjectionState,
} from "@/lib/es";
import { drainOutbox, projectDocument, reconcile } from "@/lib/outbox";
import { assertCanAdministerGroup, visibleGroupsWhere } from "@/lib/groups";
import { ingestDocument } from "@/lib/ingest";
import { fetchKeyword, fetchSemantic } from "@/lib/retrieve";
import { putObject, storageKeyFor } from "@/lib/storage";

/**
 * Security and consistency regression suite — IF-2's exit criterion.
 *
 * Every case here corresponds to a defect that was actually found in this codebase and shipped
 * to `main` at some point. Each test is named for the bug it would have caught. If one of these
 * ever goes red, a real vulnerability or a real data-consistency failure has come back.
 *
 * Needs live Postgres + Elasticsearch + MinIO (`pnpm db:up`). Route-level HTTP status codes are
 * covered separately by `pnpm acl:dao`, which drives a running server; this file covers the
 * authorization and projection layers those routes delegate to.
 */

const TAG = "[sec-regression]";
const SECRET = "quibblewick"; // distinctive: a keyword hit on it is unambiguous

let owner: { id: string };
let other: { id: string };
let groupMember: { id: string };
let group: { id: string };
const createdDocs: string[] = [];

async function makeDoc(opts: {
  isPublic?: boolean;
  ownerId?: string | null;
  grantUserId?: string;
  grantGroupId?: string;
  content?: string;
}): Promise<string> {
  const documentId = randomUUID();
  const content = opts.content ?? `${SECRET} internal plan with enough words to chunk properly.`;
  const storageKey = storageKeyFor(documentId, "doc.txt");
  await putObject(storageKey, Buffer.from(content, "utf8"), "text/plain");

  await prisma.document.create({
    data: {
      id: documentId,
      title: `${TAG} ${SECRET} doc`,
      fileName: "doc.txt",
      fileType: "txt",
      storageKey,
      status: "UPLOADED",
      isPublic: opts.isPublic ?? false,
      ownerId: opts.ownerId === undefined ? owner.id : opts.ownerId,
      grants: {
        create: [
          ...(opts.grantUserId ? [{ userId: opts.grantUserId }] : []),
          ...(opts.grantGroupId ? [{ groupId: opts.grantGroupId }] : []),
        ],
      },
    },
  });
  createdDocs.push(documentId);
  return documentId;
}

beforeAll(async () => {
  await ensureChunkIndex();
  const s = randomUUID().slice(0, 8);
  owner = await prisma.user.create({ data: { email: `sec-owner-${s}@test.invalid` }, select: { id: true } });
  other = await prisma.user.create({ data: { email: `sec-other-${s}@test.invalid` }, select: { id: true } });
  groupMember = await prisma.user.create({ data: { email: `sec-gm-${s}@test.invalid` }, select: { id: true } });
  group = await prisma.group.create({ data: { name: `${TAG}-eng-${s}` }, select: { id: true } });
  await prisma.groupMember.create({ data: { groupId: group.id, userId: groupMember.id } });
});

afterAll(async () => {
  for (const id of createdDocs) {
    await deleteDocumentChunks(id, undefined, true).catch(() => {});
    await prisma.document.delete({ where: { id } }).catch(() => {});
  }
  await prisma.outboxEvent.deleteMany({ where: { documentId: { in: createdDocs } } }).catch(() => {});
  await prisma.group.delete({ where: { id: group.id } }).catch(() => {});
  await prisma.user
    .deleteMany({ where: { id: { in: [owner.id, other.id, groupMember.id] } } })
    .catch(() => {});
  await prisma.$disconnect();
});

describe("direct object access (the unauthenticated file-download hole)", () => {
  it("refuses an anonymous reader a private document", async () => {
    const id = await makeDoc({});
    expect(await canReadDocument(await viewerFrom(null), id)).toBe(false);
  });

  it("refuses a signed-in non-owner a private document", async () => {
    const id = await makeDoc({});
    expect(await canReadDocument(await viewerFrom(other.id), id)).toBe(false);
  });

  it("allows the owner [positive control]", async () => {
    const id = await makeDoc({});
    expect(await canReadDocument(await viewerFrom(owner.id), id)).toBe(true);
  });

  it("allows anyone a public document [positive control]", async () => {
    const id = await makeDoc({ isPublic: true });
    expect(await canReadDocument(await viewerFrom(null), id)).toBe(true);
  });

  it("follows a direct grant, and stops following it once revoked", async () => {
    const id = await makeDoc({ grantUserId: other.id });
    expect(await canReadDocument(await viewerFrom(other.id), id)).toBe(true);

    const grant = await prisma.documentGrant.findFirstOrThrow({
      where: { documentId: id, userId: other.id },
      select: { id: true },
    });
    await prisma.documentGrant.delete({ where: { id: grant.id } });
    expect(await canReadDocument(await viewerFrom(other.id), id)).toBe(false);
  });

  it("follows a group grant only for members", async () => {
    const id = await makeDoc({ grantGroupId: group.id });
    expect(await canReadDocument(await viewerFrom(groupMember.id), id)).toBe(true);
    expect(await canReadDocument(await viewerFrom(other.id), id)).toBe(false);
  });
});

describe("list surfaces (the /api/jobs title leak)", () => {
  it("excludes another user's private document from a visibility-filtered list", async () => {
    // The jobs endpoint echoed document titles with no ACL at all, disclosing the names of
    // other people's private uploads. Both it and /api/documents now filter with this rule.
    const id = await makeDoc({});
    const visibleToOther = await prisma.document.findMany({
      where: { AND: [{ id }, documentVisibilityWhere(await viewerFrom(other.id))] },
      select: { id: true },
    });
    expect(visibleToOther).toHaveLength(0);
  });

  it("excludes it from an anonymous list too", async () => {
    const id = await makeDoc({});
    const visibleToAnon = await prisma.document.findMany({
      where: { AND: [{ id }, documentVisibilityWhere(await viewerFrom(null))] },
      select: { id: true },
    });
    expect(visibleToAnon).toHaveLength(0);
  });

  it("filters ingestion jobs by their document's visibility", async () => {
    const id = await makeDoc({});
    await prisma.ingestionJob.create({ data: { documentId: id, status: "COMPLETED" } });
    const jobs = await prisma.ingestionJob.findMany({
      where: { document: documentVisibilityWhere(await viewerFrom(other.id)) },
      select: { documentId: true },
    });
    expect(jobs.map((j) => j.documentId)).not.toContain(id);
  });
});

describe("retrieval enforces the ACL on BOTH legs", () => {
  it("hides a private document from both the keyword and semantic legs", async () => {
    const id = await makeDoc({});
    await ingestDocument(id);

    const stranger: Viewer = await viewerFrom(other.id);
    const kw = await fetchKeyword(SECRET, null, stranger);
    const sm = await fetchSemantic(SECRET, null, stranger);
    expect(kw.map((c) => c.documentId)).not.toContain(id);
    expect(sm.map((c) => c.documentId)).not.toContain(id);

    // Positive control: the owner does get it, so the filter is not simply returning nothing.
    const asOwner = await fetchKeyword(SECRET, null, await viewerFrom(owner.id));
    expect(asOwner.map((c) => c.documentId)).toContain(id);
  });
});

describe("cross-store consistency (the lost revoke and the false 'ready')", () => {
  it("does not lose a revoke that lands while an index is in flight", async () => {
    // The original bug: ingest read the ACL, embedded for seconds, then wrote that stale
    // snapshot to ES — silently reinstating access that had been revoked in between.
    const id = await makeDoc({ grantUserId: other.id });
    await ingestDocument(id);
    expect((await fetchKeyword(SECRET, null, await viewerFrom(other.id))).map((c) => c.documentId))
      .toContain(id);

    const reindex = ingestDocument(id);
    await new Promise((r) => setTimeout(r, 150)); // let it get past its ACL read
    const grant = await prisma.documentGrant.findFirstOrThrow({
      where: { documentId: id, userId: other.id },
      select: { id: true },
    });
    await prisma.documentGrant.delete({ where: { id: grant.id } });
    await syncDocumentAcl(id, true);
    await reindex;

    const after = await fetchKeyword(SECRET, null, await viewerFrom(other.id));
    expect(after.map((c) => c.documentId)).not.toContain(id);
  });

  it("never reports a document INDEXED before the keyword index actually has it", async () => {
    const id = await makeDoc({});
    await ingestDocument(id, { project: false }); // as if the process died before projecting

    const doc = await prisma.document.findUnique({ where: { id }, select: { status: true } });
    expect(doc?.status).not.toBe("INDEXED");
    expect(await countDocumentChunks(id)).toBe(0);
  });

  it("records the owed projection durably, and completes it on drain", async () => {
    const id = await makeDoc({});
    await ingestDocument(id, { project: false });

    expect(
      await prisma.outboxEvent.count({ where: { documentId: id, status: "PENDING" } }),
    ).toBeGreaterThan(0);

    await drainOutbox();
    const doc = await prisma.document.findUnique({ where: { id }, select: { status: true } });
    expect(doc?.status).toBe("INDEXED");
    expect(await countDocumentChunks(id)).toBeGreaterThan(0);
  });

  it("detects and repairs drift introduced outside the application", async () => {
    const id = await makeDoc({});
    await ingestDocument(id);
    expect(await countDocumentChunks(id)).toBeGreaterThan(0);

    await deleteDocumentChunks(id, undefined, true); // clobber ES behind the app's back
    expect(await countDocumentChunks(id)).toBe(0);

    const { repaired } = await reconcile();
    expect(repaired).toContain(id);
    await drainOutbox();
    expect(await countDocumentChunks(id)).toBeGreaterThan(0);
  });

  it("is idempotent: projecting repeatedly converges instead of duplicating", async () => {
    const id = await makeDoc({});
    await ingestDocument(id);
    const first = await countDocumentChunks(id);

    await projectDocument(id);
    await projectDocument(id);
    expect(await countDocumentChunks(id)).toBe(first);
  });

  it("mirrors the document's versions onto its chunks, so staleness is detectable", async () => {
    const id = await makeDoc({});
    await ingestDocument(id);
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id },
      select: { aclVersion: true, contentVersion: true },
    });
    const es = await getProjectionState(id);
    expect(es.aclVersion).toBe(doc.aclVersion);
    expect(es.contentVersion).toBe(doc.contentVersion);
  });

  it("removes chunks from the keyword index when the document is deleted", async () => {
    // Content must not remain searchable after its document is gone.
    const id = await makeDoc({});
    await ingestDocument(id);
    expect(await countDocumentChunks(id)).toBeGreaterThan(0);

    await prisma.document.delete({ where: { id } });
    await projectDocument(id); // what the DELETE route's outbox event triggers
    expect(await countDocumentChunks(id)).toBe(0);
  });
});

describe("group administration (the self-service membership escalation)", () => {
  /**
   * Group membership IS an access-control decision: a viewer's principals include a
   * `group:<id>` token for every group they belong to, so adding yourself to a group grants read
   * access to every document shared with it. These endpoints originally required only a
   * signed-in caller, and the escalation was reproduced end to end against a running server — a
   * guest added itself to a restricted group and immediately read the restricted document.
   */
  const mkGroup = (label: string, ownerId: string | null, memberIds: string[] = []) =>
    prisma.group.create({
      data: {
        name: `${TAG}-${label}-${randomUUID().slice(0, 6)}`,
        ownerId,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });

  it("refuses a stranger, without confirming the group exists", async () => {
    const g = await mkGroup("owned", owner.id);
    try {
      // 404, not 403 — group ids must not be probeable.
      await expect(assertCanAdministerGroup(g.id, other.id)).rejects.toMatchObject({ status: 404 });
    } finally {
      await prisma.group.delete({ where: { id: g.id } }).catch(() => {});
    }
  });

  it("refuses a mere MEMBER permission to change membership", async () => {
    // Being in a group is not administering it. If members could add members, one compromised
    // account would re-open the whole escalation.
    const g = await mkGroup("member", owner.id, [other.id]);
    try {
      await expect(assertCanAdministerGroup(g.id, other.id)).rejects.toMatchObject({ status: 403 });
    } finally {
      await prisma.group.delete({ where: { id: g.id } }).catch(() => {});
    }
  });

  it("allows the owner [positive control]", async () => {
    const g = await mkGroup("owner-ok", owner.id);
    try {
      await expect(assertCanAdministerGroup(g.id, owner.id)).resolves.toBeUndefined();
    } finally {
      await prisma.group.delete({ where: { id: g.id } }).catch(() => {});
    }
  });

  it("treats an ownerless group as unmanageable by anyone", async () => {
    // Fails closed. Inferring an owner (say, the first member) would hand control to somebody who
    // was merely added — the same escalation in a smaller costume.
    const g = await mkGroup("orphan", null, [other.id]);
    try {
      await expect(assertCanAdministerGroup(g.id, other.id)).rejects.toBeInstanceOf(AccessError);
      await expect(assertCanAdministerGroup(g.id, owner.id)).rejects.toBeInstanceOf(AccessError);
    } finally {
      await prisma.group.delete({ where: { id: g.id } }).catch(() => {});
    }
  });

  it("does not list groups the caller neither owns nor belongs to", async () => {
    // The listing used to expose every group name and every member's email address.
    const g = await mkGroup("hidden", owner.id);
    try {
      const toStranger = await prisma.group.findMany({
        where: { AND: [{ id: g.id }, visibleGroupsWhere(other.id)] },
        select: { id: true },
      });
      expect(toStranger).toHaveLength(0);

      const toOwner = await prisma.group.findMany({
        where: { AND: [{ id: g.id }, visibleGroupsWhere(owner.id)] },
        select: { id: true },
      });
      expect(toOwner).toHaveLength(1);
    } finally {
      await prisma.group.delete({ where: { id: g.id } }).catch(() => {});
    }
  });

  it("end to end: a stranger cannot reach a group-shared document by self-adding", async () => {
    const g = await mkGroup("e2e", owner.id);
    const docId = await makeDoc({ grantGroupId: g.id });
    try {
      expect(await canReadDocument(await viewerFrom(other.id), docId)).toBe(false);
      await expect(assertCanAdministerGroup(g.id, other.id)).rejects.toBeInstanceOf(AccessError);
      expect(await canReadDocument(await viewerFrom(other.id), docId)).toBe(false);
    } finally {
      await prisma.group.delete({ where: { id: g.id } }).catch(() => {});
    }
  });
});
