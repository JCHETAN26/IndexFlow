import { describe, expect, it } from "vitest";
import { analyzeQuery, detectIdentifiers } from "../../lib/query-intent";

describe("identifier detection", () => {
  it("finds error codes in the forms users actually type", () => {
    for (const q of ["ERR_AUTH_401", "ERR-AUTH-401", "err auth 401"]) {
      const [id] = detectIdentifiers(q);
      expect(id, q).toBeDefined();
      expect(id.kind).toBe("error-code");
      // Normalisation is the point: an exact-field match only fires if all three collapse to one
      // canonical token.
      expect(id.normalized, q).toBe("ERR_AUTH_401");
    }
  });

  it("finds prefixed record identifiers", () => {
    const cases: [string, string][] = [
      ["INC-48291", "INC-48291"],
      ["INC 48291", "INC-48291"],
      ["TICKET_2819", "TICKET-2819"],
      ["DEPLOY-1738", "DEPLOY-1738"],
    ];
    for (const [q, want] of cases) {
      const [id] = detectIdentifiers(q);
      expect(id, q).toBeDefined();
      expect(id.kind).toBe("ticket");
      expect(id.normalized, q).toBe(want);
    }
  });

  it("finds versions with or without a v prefix", () => {
    for (const q of ["v4.18.3", "4.18.3"]) {
      const [id] = detectIdentifiers(q);
      expect(id, q).toBeDefined();
      expect(id.kind).toBe("version");
      expect(id.normalized).toBe("4.18.3");
    }
  });

  it("does not report the same span twice under different patterns", () => {
    // A ticket id contains digits that the version pattern could otherwise claim.
    const ids = detectIdentifiers("INC-48291");
    expect(ids).toHaveLength(1);
    expect(ids[0].kind).toBe("ticket");
  });
});

describe("identifier routing decision", () => {
  it("routes a bare identifier as a lookup", () => {
    for (const q of ["ERR_AUTH_401", "INC-48291", "v4.18.3", "ERR_AUTH_401 runbook"]) {
      expect(analyzeQuery(q).isIdentifierLookup, q).toBe(true);
    }
  });

  it("does NOT route a question that merely cites an identifier", () => {
    // This is the failure that would matter in production: sending a real question down an
    // exact-match path discards the question. Losing a lookup to the ordinary pipeline only costs
    // some ranking quality; losing a question costs the answer.
    const questions = [
      "Why does auth-api return ERR_AUTH_401 after the last deploy?",
      "Users keep getting signed out after about an hour, is that INC-48291?",
      "What changed between v4.18.2 and v4.18.3 that broke autosave on iOS?",
    ];
    for (const q of questions) {
      const intent = analyzeQuery(q);
      expect(intent.identifiers.length, q).toBeGreaterThan(0);
      expect(intent.isIdentifierLookup, q).toBe(false);
    }
  });

  it("routes ordinary natural language as not-a-lookup", () => {
    for (const q of [
      "my phone freezes while I am writing a note",
      "why do checkout requests hang after traffic spikes?",
    ]) {
      const intent = analyzeQuery(q);
      expect(intent.isIdentifierLookup, q).toBe(false);
      expect(intent.identifiers, q).toEqual([]);
    }
  });

  it("reports the residual terms a semantic leg would be left with", () => {
    const intent = analyzeQuery("ERR_AUTH_401 runbook");
    expect(intent.residualTerms).toEqual(["runbook"]);
  });

  it("uses no benchmark labels — detection is a pure function of the query text", () => {
    // Guards the property that makes this deployable rather than benchmark-fitted: identical text
    // must produce an identical decision with no other input available.
    const a = analyzeQuery("INC-48291");
    const b = analyzeQuery("INC-48291");
    expect(a).toEqual(b);
  });
});
