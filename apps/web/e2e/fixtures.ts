/**
 * Fixture corpus for the end-to-end suite.
 *
 * Two documents with deliberately distinctive, non-overlapping vocabulary: one public, one
 * private to a user the browser never signs in as. Every permission assertion in the suite is
 * "the guest finds PUBLIC_TERM and never finds PRIVATE_TERM", which is only meaningful if the
 * terms cannot be confused with each other or with the seeded demo corpus.
 */
export const PUBLIC_TERM = "flimberwock";
export const PRIVATE_TERM = "grondulate";

export const PUBLIC_TITLE = "[e2e] public handbook";
export const PRIVATE_TITLE = "[e2e] private compensation memo";

export const PUBLIC_BODY =
  `The ${PUBLIC_TERM} handbook explains onboarding for new engineers. ` +
  `${PUBLIC_TERM} covers laptop setup, repository access and the first-week checklist. ` +
  `Everyone in the company may read the ${PUBLIC_TERM} handbook, so it is marked public.`;

export const PRIVATE_BODY =
  `The ${PRIVATE_TERM} memo records individual salary bands and equity refreshes. ` +
  `${PRIVATE_TERM} details are restricted to its owner and must never surface to another ` +
  `principal through search, answers, or any listing surface.`;

/** Marks every row this suite creates, so teardown can find them without guessing. */
export const E2E_TAG = "[e2e]";
