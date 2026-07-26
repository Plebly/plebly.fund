/**
 * Suggested proposal tags from Plebly/proposals TAGS.md.
 * Freeform tags are allowed; prefer these when they fit.
 */
export const SUGGESTED_PROPOSAL_TAGS = [
  "knots",
  "policy",
  "docs",
  "research",
  "tooling",
  "education",
  "lightning",
  "ui",
  "security",
  "commons",
] as const;

export const MAX_PROPOSAL_TAGS = 12;

/** Normalize a raw tag token for storage/search. */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.+_-]/g, "")
    .replace(/^-+|-+$/g, "");
  if (!tag || tag.length > 40) return null;
  return tag;
}

export function parseTagList(
  raw: string | string[] | null | undefined,
  max = MAX_PROPOSAL_TAGS,
): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || "").split(/[,]+/);
  const out: string[] = [];
  for (const part of parts) {
    const tag = normalizeTag(part);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export function filterSuggestedTags(
  query: string,
  selected: string[],
  vocabulary: readonly string[] = SUGGESTED_PROPOSAL_TAGS,
): string[] {
  const q = query.trim().toLowerCase();
  const selectedSet = new Set(selected);
  return vocabulary.filter((tag) => {
    if (selectedSet.has(tag)) return false;
    if (!q) return true;
    return tag.includes(q);
  });
}
