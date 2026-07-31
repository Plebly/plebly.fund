import { describe, expect, it } from "vitest";
import { claimFloorShortfall } from "./builder";
import type { Proposal } from "./types";

function proposal(
  overrides: Partial<Proposal> & Pick<Proposal, "status">,
): Proposal {
  return {
    id: "p",
    title: "t",
    path: "x.md",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    ...overrides,
  };
}

describe("claimFloorShortfall", () => {
  it("sums sats needed for open projects below the floor", () => {
    const out = claimFloorShortfall(
      [
        proposal({ status: "funding", balance_sats: 2_000 }),
        proposal({ status: "listed", balance_sats: 8_000 }),
        proposal({ status: "funding", balance_sats: 10_000 }),
        proposal({ status: "claimed", balance_sats: 1_000, claimer: "alice" }),
        proposal({ status: "completed", balance_sats: 0 }),
      ],
      10_000,
    );
    expect(out.projectCount).toBe(2);
    expect(out.shortfallSats).toBe(8_000 + 2_000);
    expect(out.fundedTowardFloor).toBe(2_000 + 8_000);
  });

  it("returns zero when every open project meets the floor", () => {
    const out = claimFloorShortfall(
      [proposal({ status: "claimable", balance_sats: 50_000 })],
      10_000,
    );
    expect(out).toEqual({
      shortfallSats: 0,
      projectCount: 0,
      fundedTowardFloor: 0,
    });
  });
});
