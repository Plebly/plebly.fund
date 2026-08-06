import { describe, expect, it } from "vitest";
import {
  claimModeChipHtml,
  claimModeHeroChipHtml,
  deadlineChipLabel,
  picksInChipLabel,
  refreshClaimModeChips,
  relativeTimeLeft,
} from "./claim-mode-ui";
import type { Proposal } from "./types";

function openBounty(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "listed",
    proposal_type: "bounty",
    target_sats: null,
    escrow_address: "tb1qtest",
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 200_000,
    claim_mode: "proposer_select",
    ...partial,
  };
}

describe("deadlineChipLabel / relativeTimeLeft", () => {
  const now = Date.parse("2026-08-06T12:00:00.000Z");

  it("formats picks/auto deadlines", () => {
    expect(
      deadlineChipLabel(
        new Date(now + 3 * 86_400_000).toISOString(),
        "picks",
        now,
      ),
    ).toBe("Picks in 3d");
    expect(
      deadlineChipLabel(
        new Date(now + 5 * 3_600_000).toISOString(),
        "auto",
        now,
      ),
    ).toBe("Auto in 5h");
    expect(picksInChipLabel(null, now)).toBe("Open to apply");
  });

  it("formats relative left strings", () => {
    expect(
      relativeTimeLeft(new Date(now + 30 * 3_600_000).toISOString(), now),
    ).toBe("30h left");
    expect(
      relativeTimeLeft(new Date(now - 1_000).toISOString(), now),
    ).toBe("ending soon");
  });
});

describe("claimModeChipHtml", () => {
  const now = Date.parse("2026-08-06T12:00:00.000Z");
  const ends = new Date(now + 4 * 86_400_000).toISOString();

  it("returns empty for direct or below floor", () => {
    expect(
      claimModeChipHtml(openBounty({ proposal_type: "direct" }), 100_000, now),
    ).toBe("");
    expect(
      claimModeChipHtml(openBounty({ balance_sats: 1 }), 100_000, now),
    ).toBe("");
  });

  it("shows first bonded mode", () => {
    const html = claimModeChipHtml(
      openBounty({ claim_mode: "first_bonded" }),
      100_000,
      now,
    );
    expect(html).toContain("First bonded");
  });

  it("shows applying count and picks deadline", () => {
    const html = claimModeChipHtml(
      openBounty({
        claim_apps_bonded: 2,
        claim_apps_total: 2,
        claim_phase: "collecting",
        claim_window_ends_at: ends,
      }),
      100_000,
      now,
    );
    expect(html).toContain("2 applying");
    expect(html).toContain("Picks in 4d");
    expect(html).toContain('data-claim-chip="picks"');
  });

  it("shows grace auto chip", () => {
    const html = claimModeChipHtml(
      openBounty({
        claim_apps_bonded: 1,
        claim_phase: "grace",
        claim_decision_ends_at: ends,
      }),
      100_000,
      now,
    );
    expect(html).toContain("1 bonded");
    expect(html).toContain("Auto in 4d");
  });

  it("falls back to Open to apply", () => {
    expect(claimModeChipHtml(openBounty(), 100_000, now)).toContain(
      "Open to apply",
    );
  });

  it("does not show picks countdown with zero bonded applicants", () => {
    const html = claimModeChipHtml(
      openBounty({
        claim_apps_bonded: 0,
        claim_apps_total: 0,
        claim_phase: "collecting",
        claim_window_ends_at: ends,
      }),
      100_000,
      now,
    );
    expect(html).toContain("Open to apply");
    expect(html).not.toContain("Picks in");
    expect(html).not.toContain("data-claim-chip");
  });

  it("hero chip uses proposal meta classes", () => {
    const html = claimModeHeroChipHtml(
      openBounty({ claim_mode: "first_bonded" }),
      100_000,
      now,
    );
    expect(html).toContain("proposal-meta-chip");
    expect(html).toContain('id="proposal-claim-mode-chip"');
  });

  it("refreshClaimModeChips updates relative labels", () => {
    document.body.innerHTML = claimModeChipHtml(
      openBounty({
        claim_apps_bonded: 1,
        claim_window_ends_at: ends,
        claim_phase: "collecting",
      }),
      100_000,
      now,
    );
    const later = now + 86_400_000;
    refreshClaimModeChips(document, later);
    expect(document.body.textContent).toContain("1 applying");
    expect(document.body.textContent).toContain("Picks in 3d");
  });
});
