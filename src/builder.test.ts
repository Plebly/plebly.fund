import { describe, expect, it } from "vitest";
import {
  claimWindowDaysLeft,
  isDirectProposal,
  isNearFloor,
  isOpenToClaim,
  isTakenStatus,
} from "./builder";
import type { Proposal } from "./types";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "listed",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    ...partial,
  };
}

describe("claim floor helpers", () => {
  it("isTakenStatus covers claim lifecycle", () => {
    expect(isTakenStatus("claimed")).toBe(true);
    expect(isTakenStatus("in_review")).toBe(true);
    expect(isTakenStatus("rejected")).toBe(true);
    expect(isTakenStatus("listed")).toBe(false);
  });

  it("isOpenToClaim requires claimable status, no claimer, and floor", () => {
    const floor = 100_000;
    expect(
      isOpenToClaim(
        proposal({ status: "listed", balance_sats: floor, claimer: null }),
        floor,
      ),
    ).toBe(true);
    expect(
      isOpenToClaim(
        proposal({ status: "funding", balance_sats: floor - 1 }),
        floor,
      ),
    ).toBe(false);
    expect(
      isOpenToClaim(
        proposal({ status: "listed", balance_sats: floor, claimer: "github:1" }),
        floor,
      ),
    ).toBe(false);
    expect(
      isOpenToClaim(proposal({ status: "claimed", balance_sats: floor * 2 }), floor),
    ).toBe(false);
  });

  it("isNearFloor is half-to-floor exclusive of open", () => {
    const floor = 100_000;
    expect(
      isNearFloor(proposal({ status: "listed", balance_sats: 50_000 }), floor),
    ).toBe(true);
    expect(
      isNearFloor(proposal({ status: "listed", balance_sats: 49_999 }), floor),
    ).toBe(false);
    expect(
      isNearFloor(proposal({ status: "listed", balance_sats: 100_000 }), floor),
    ).toBe(false);
  });

  it("claimWindowDaysLeft prefers claim_window_ends_at (extensions)", () => {
    const claimed = "2026-01-01T00:00:00.000Z";
    const ends = new Date(Date.now() + 10 * 86400_000).toISOString();
    const days = claimWindowDaysLeft(claimed, ends);
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it("direct proposals are never open-to-claim or near-floor claim filters", () => {
    const floor = 100_000;
    const direct = proposal({
      proposal_type: "direct",
      status: "listed",
      balance_sats: floor,
    });
    expect(isDirectProposal(direct)).toBe(true);
    expect(isDirectProposal(proposal({ proposal_type: undefined }))).toBe(false);
    expect(isOpenToClaim(direct, floor)).toBe(false);
    expect(isNearFloor(direct, floor)).toBe(false);
  });
});
