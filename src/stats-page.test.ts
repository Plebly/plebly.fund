import { describe, expect, it } from "vitest";
import { CORE_ANNUAL_GAP_SATS } from "./config";
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
  it("aggregates escrow, open/completed counts, and claim completion", () => {
    const stats = computePublicStats([
      proposal({ status: "funding", balance_sats: 100_000 }),
      proposal({ status: "claimed", balance_sats: 50_000 }),
      proposal({
        status: "completed",
        balance_sats: 0,
        target_sats: 200_000,
      }),
      proposal({ status: "in_review", balance_sats: 10_000 }),
    ]);

    expect(stats.tracked).toBe(4);
    expect(stats.open).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.claimedLifecycle).toBe(3);
    expect(stats.escrowed).toBe(160_000);
    expect(stats.paidEstimate).toBe(200_000);
    expect(stats.completionRate).toBe(33);
    expect(stats.gapPercent).toBe(
      Math.min(100, Math.round((160_000 / CORE_ANNUAL_GAP_SATS) * 100)),
    );
  });

  it("returns null completion rate when no claim lifecycle yet", () => {
    const stats = computePublicStats([
      proposal({ status: "listed", balance_sats: 0 }),
    ]);
    expect(stats.completionRate).toBeNull();
    expect(stats.claimedLifecycle).toBe(0);
  });
});
