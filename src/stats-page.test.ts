import { describe, expect, it } from "vitest";
import { CLAIM_FLOOR_SATS } from "./config";
import { computePublicStats } from "./stats-page";
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

describe("computePublicStats", () => {
  it("aggregates escrow, open/completed counts, and claim-floor shortfall", () => {
    const stats = computePublicStats([
      proposal({ status: "funding", balance_sats: 100_000 }),
      proposal({ status: "claimed", balance_sats: 50_000, claimer: "bob" }),
      proposal({
        status: "completed",
        balance_sats: 0,
        target_sats: 200_000,
      }),
      proposal({ status: "in_review", balance_sats: 10_000, claimer: "carol" }),
      proposal({ status: "listed", balance_sats: 1_000 }),
    ]);

    expect(stats.tracked).toBe(5);
    expect(stats.open).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.claimedLifecycle).toBe(3);
    expect(stats.escrowed).toBe(161_000);
    expect(stats.paidEstimate).toBe(200_000);
    expect(stats.completionRate).toBe(33);
    // Floor comes from parameters (signet 10k): only the 1k listed project is short.
    expect(stats.belowFloorCount).toBe(1);
    expect(stats.shortfallSats).toBe(CLAIM_FLOOR_SATS - 1_000);
    expect(stats.fundedTowardFloor).toBe(1_000);
  });

  it("returns null completion rate when no claim lifecycle yet", () => {
    const stats = computePublicStats([
      proposal({ status: "listed", balance_sats: 0 }),
    ]);
    expect(stats.completionRate).toBeNull();
    expect(stats.claimedLifecycle).toBe(0);
    expect(stats.belowFloorCount).toBe(1);
  });
});
