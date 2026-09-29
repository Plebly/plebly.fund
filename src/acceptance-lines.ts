/**
 * Keep in sync with workers/src/lib/ai-review.ts namedRequirementLines.
 * One yes/no check per line: `1.` / `1)` / `-` / `*`.
 */
export const NAMED_REQUIREMENT_MIN = 3;
export const NAMED_REQUIREMENT_MAX = 12;

const NAMED_REQUIREMENT_LINE = /^(?:\d+[.)]\s+|[-*]\s+)(.+)$/;
/** Inline `1. a 2. b 3. c` is not one check per line. */
const EXTRA_NUMBERED_MARKER = /(?:^|\s)\d+[.)]\s+\S/;

function parseNamedRequirementLines(text: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(text || "").split("\n")) {
    const t = line.trim();
    const m = t.match(NAMED_REQUIREMENT_LINE);
    if (!m) continue;
    const item = m[1].trim().slice(0, 240);
    if (!item || EXTRA_NUMBERED_MARKER.test(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

export function namedRequirementLines(text: string): string[] {
  return parseNamedRequirementLines(text, NAMED_REQUIREMENT_MAX);
}

/** Unique matching lines with no send cap — reject 13+ before a silent truncate. */
export function countNamedRequirementLines(text: string): number {
  return parseNamedRequirementLines(text, Number.MAX_SAFE_INTEGER).length;
}

export function bountyVerificationFieldError(text: string): string | null {
  const n = countNamedRequirementLines(text);
  if (n < NAMED_REQUIREMENT_MIN) {
    return "Number or bullet each yes/no check on its own line (3–12).";
  }
  if (n > NAMED_REQUIREMENT_MAX) {
    return "At most 12 scored checks.";
  }
  return null;
}

export function bountyVerificationScoreHint(text: string): string {
  const n = countNamedRequirementLines(text);
  if (n >= NAMED_REQUIREMENT_MIN && n <= NAMED_REQUIREMENT_MAX) {
    return `AI can score these ${n} lines.`;
  }
  if (n > NAMED_REQUIREMENT_MAX) {
    return "At most 12 scored checks.";
  }
  return "Add numbered or bulleted checks — AI cannot score prose.";
}

export const CAMPAIGN_VERIFICATION_HINT =
  "Two independent reviewers should reach the same yes/no conclusion. Numbered steps (1. 2.) render as a checklist on the project page.";

export const BOUNTY_VERIFICATION_PLACEHOLDER =
  "1. Clone the public repo at the submitted commit.\n2. Run the documented tests.\n3. Confirm two reviewers independently get the same yes/no.";
