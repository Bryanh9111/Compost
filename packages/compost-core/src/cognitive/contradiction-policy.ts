/**
 * Shared contradiction policy for read-only triage and write-side reflect.
 *
 * A same (subject, predicate) pair with multiple objects is only actionable
 * when the predicate is known to be functional/single-valued. Extraction and
 * LLM predicates are open-ended, so unknown predicates default to fan-out,
 * not contradiction. This intentionally prefers missed conflict surfacing over
 * destructive false arbitration.
 */

export const SINGLE_VALUE_CONTRADICTION_PREDICATES: readonly string[] = [
  "capital-of",
] as const;

export const GENERIC_CONTRADICTION_SUBJECTS: readonly string[] = [
  "background",
  "content",
  "description",
  "images",
  "local entry points",
  "milestone overview",
  "milestone 总览",
  "notes",
  "repositories",
  "source content",
  "visual summary",
  "video",
  "video frame summary",
  "下一步",
  "背景",
] as const;

const singleValuePredicateSet = new Set<string>(
  SINGLE_VALUE_CONTRADICTION_PREDICATES
);
const genericSubjectSet = new Set<string>(GENERIC_CONTRADICTION_SUBJECTS);

export function normalizeContradictionField(value: string): string {
  return value.trim().toLowerCase();
}

export function isSingleValueContradictionPredicate(
  predicate: string
): boolean {
  return singleValuePredicateSet.has(normalizeContradictionField(predicate));
}

export function isGenericContradictionSubject(subject: string): boolean {
  const normalized = normalizeContradictionField(subject);
  return genericSubjectSet.has(normalized) || /^image\s+\d+$/.test(normalized);
}

export function isContradictionCandidate(
  subject: string,
  predicate: string
): boolean {
  return (
    isSingleValueContradictionPredicate(predicate) &&
    !isGenericContradictionSubject(subject)
  );
}
