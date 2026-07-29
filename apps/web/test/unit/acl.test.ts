import { describe, expect, it } from "vitest";
import { PUBLIC, aclTokens, groupToken, userToken, type AclDocument } from "@/lib/acl";

/**
 * ACL token derivation. `aclTokens` decides what gets denormalised onto every Elasticsearch
 * chunk, and the keyword leg filters on exactly these strings — so a wrong token here is a
 * silent permission bug that no amount of route-level review would catch.
 */

const doc = (over: Partial<AclDocument> = {}): AclDocument => ({
  isPublic: false,
  ownerId: null,
  grants: [],
  ...over,
});

describe("aclTokens", () => {
  it("emits nothing for a document nobody can see", () => {
    expect(aclTokens(doc())).toEqual([]);
  });

  it("emits the public token only when the document is public", () => {
    expect(aclTokens(doc({ isPublic: true }))).toContain(PUBLIC);
    expect(aclTokens(doc({ isPublic: false }))).not.toContain(PUBLIC);
  });

  it("always includes the owner", () => {
    expect(aclTokens(doc({ ownerId: "u1" }))).toEqual([userToken("u1")]);
  });

  it("includes user and group grants", () => {
    const tokens = aclTokens(
      doc({ ownerId: "owner", grants: [{ userId: "u2", groupId: null }, { userId: null, groupId: "g1" }] }),
    );
    expect(tokens).toEqual(expect.arrayContaining([userToken("owner"), userToken("u2"), groupToken("g1")]));
    expect(tokens).toHaveLength(3);
  });

  it("de-duplicates a grant that repeats the owner", () => {
    const tokens = aclTokens(doc({ ownerId: "u1", grants: [{ userId: "u1", groupId: null }] }));
    expect(tokens).toEqual([userToken("u1")]);
  });

  it("ignores a malformed grant with neither principal", () => {
    // The database now rejects these (document_grants_exactly_one_principal), but the code must
    // not widen access if one ever appears — e.g. from a migration or a direct SQL edit.
    expect(aclTokens(doc({ grants: [{ userId: null, groupId: null }] }))).toEqual([]);
  });

  it("keeps user and group namespaces distinct", () => {
    // A bare id would make user "x" and group "x" collide and grant each other's access.
    expect(userToken("x")).not.toEqual(groupToken("x"));
  });
});
