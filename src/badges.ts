/** Keep in sync with PARAMETERS.md / workers claim-params. */
export const BADGE_NOTABLE_SATS = 21_000;
export const BADGE_MAJOR_SATS = 100_000;
export const BADGE_PATRON_SATS = 1_000_000;

export type ContributorBadge = "notable" | "major" | "patron";

/** Highest badge for a confirmed contribution amount (sats). */
export function contributorBadge(
  amountSats: number | null | undefined,
): ContributorBadge | null {
  const n = typeof amountSats === "number" ? amountSats : 0;
  if (n >= BADGE_PATRON_SATS) return "patron";
  if (n >= BADGE_MAJOR_SATS) return "major";
  if (n >= BADGE_NOTABLE_SATS) return "notable";
  return null;
}

export function contributorBadgeLabel(badge: ContributorBadge): string {
  switch (badge) {
    case "patron":
      return "Patron";
    case "major":
      return "Major";
    case "notable":
      return "Notable";
  }
}
