// Thresholds come from proposals/parameters.json (same source as workers claim-params).
import {
  BADGE_MAJOR_SATS,
  BADGE_NOTABLE_SATS,
  BADGE_PATRON_SATS,
} from "./generated/parameters";

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
