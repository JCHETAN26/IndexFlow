-- A grant must target exactly one principal: a user OR a group, never both, never neither.
--
-- Without this, two malformed rows are representable:
--   * both NULL  → a grant that grants nothing; aclTokens() emits no token for it, so the row is
--                  invisible dead weight that still looks like a share in the UI.
--   * both set   → ambiguous semantics; lib/acl aclTokens() would emit BOTH a user: and a group:
--                  token from one row, silently widening access beyond what was intended.
-- The application only ever writes one principal (see lib/sharing.ts addGrant), so this constraint
-- records an invariant the code already assumes rather than changing behaviour.

-- Fail loudly if existing data violates the invariant, instead of letting ADD CONSTRAINT emit a
-- less obvious error. Offending rows must be reconciled by hand: they represent real intent that
-- was recorded ambiguously, so deleting them automatically could silently revoke someone's access.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM document_grants
  WHERE (user_id IS NULL) = (group_id IS NULL);

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add document_grants_exactly_one_principal: % row(s) have both or neither principal set. Inspect them with: SELECT * FROM document_grants WHERE (user_id IS NULL) = (group_id IS NULL);',
      bad_count;
  END IF;
END $$;

ALTER TABLE "document_grants"
  ADD CONSTRAINT "document_grants_exactly_one_principal"
  CHECK ((user_id IS NULL) <> (group_id IS NULL));
