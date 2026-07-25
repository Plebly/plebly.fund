import { describe, expect, it } from "vitest";
import { isNearFloor, isOpenToClaim, isTakenStatus } from "./builder";
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
});
