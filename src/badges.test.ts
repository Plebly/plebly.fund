import { describe, expect, it } from "vitest";
import { contributorBadge, contributorBadgeLabel } from "./badges";
import {
  BADGE_MAJOR_SATS,
  BADGE_NOTABLE_SATS,
  BADGE_PATRON_SATS,
} from "./generated/parameters";

describe("contributorBadge", () => {
  it("uses the generated parameters.json thresholds", () => {
    // Pins today's values so a parameters change is a visible diff here.
    expect([BADGE_NOTABLE_SATS, BADGE_MAJOR_SATS, BADGE_PATRON_SATS]).toEqual([
      21_000, 100_000, 1_000_000,
    ]);
  });

  it("awards the highest badge reached, thresholds inclusive", () => {
    expect(contributorBadge(BADGE_NOTABLE_SATS - 1)).toBeNull();
    expect(contributorBadge(BADGE_NOTABLE_SATS)).toBe("notable");
    expect(contributorBadge(BADGE_MAJOR_SATS - 1)).toBe("notable");
    expect(contributorBadge(BADGE_MAJOR_SATS)).toBe("major");
    expect(contributorBadge(BADGE_PATRON_SATS - 1)).toBe("major");
    expect(contributorBadge(BADGE_PATRON_SATS)).toBe("patron");
    expect(contributorBadge(BADGE_PATRON_SATS * 10)).toBe("patron");
  });

  it("treats missing or non-numeric amounts as zero", () => {
    expect(contributorBadge(null)).toBeNull();
    expect(contributorBadge(undefined)).toBeNull();
    expect(contributorBadge(0)).toBeNull();
    expect(contributorBadge("100000" as unknown as number)).toBeNull();
  });
});

describe("contributorBadgeLabel", () => {
  it("labels each badge", () => {
    expect(contributorBadgeLabel("notable")).toBe("Notable");
    expect(contributorBadgeLabel("major")).toBe("Major");
    expect(contributorBadgeLabel("patron")).toBe("Patron");
  });
});
