import { describe, expect, it } from "vitest";
import { builderPanelHtml, claimerTrackHtml } from "./builder-panel";
import type { ClaimStatus } from "./builder";
import type { Proposal } from "./types";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "listed",
    target_sats: null,
    escrow_address: "tb1qtest",
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 200_000,
    ...partial,
  };
}

describe("builderPanelHtml proposal types", () => {
  it("hides claim UI for direct proposals", () => {
    const html = builderPanelHtml(
      proposal({ proposal_type: "direct" }),
      200_000,
      false,
    );
    expect(html).toContain("direct-deliverable-slot");
    expect(html).not.toContain("builder-title");
    expect(html).not.toContain("Direct funding");
    expect(html).not.toContain("builder-claim-modal");
    expect(html).not.toContain("Claim this project");
    expect(html).not.toContain("builder-evaluating");
  });

  it("keeps claim modal for bounty proposals", () => {
    const html = builderPanelHtml(proposal({ proposal_type: "bounty" }), 200_000, false);
    expect(html).toContain("builder-claim-modal");
    expect(html).toContain("Claim this project");
    expect(html).not.toContain("builder-title");
    expect(html).not.toContain(">Build<");
    expect(html).not.toContain("direct-deliverable-slot");
    expect(html).not.toContain("builder-evaluating");
  });

  it("uses progress copy instead of a disabled claim below floor", () => {
    const html = builderPanelHtml(proposal({ balance_sats: 1 }), 1, false);
    expect(html).toContain("Needs");
    expect(html).not.toContain('id="builder-claim" disabled');
  });
});

describe("claimerTrackHtml", () => {
  const base: ClaimStatus = {
    proposal_id: "p1",
    proposal_path: "proposals/listed/p1.md",
    state: "claimed",
    confirmed_balance_sats: 100_000,
    claim_floor_sats: 10_000,
  };

  it("omits block when summary absent", () => {
    expect(claimerTrackHtml(base)).toBe("");
    expect(claimerTrackHtml({ ...base, claimer_summary: null })).toBe("");
  });

  it("shows First claim when all zeros", () => {
    expect(
      claimerTrackHtml({
        ...base,
        claimer_summary: {
          active: 0,
          completed: 0,
          expired: 0,
          rejected: 0,
          abandoned: 0,
        },
      }),
    ).toContain("First claim");
  });

  it("computes submitted/failed/rate from outcome buckets", () => {
    const html = claimerTrackHtml({
      ...base,
      claimer_summary: {
        active: 1,
        completed: 2,
        expired: 1,
        rejected: 1,
        abandoned: 0,
      },
    });
    // submitted = 1+2+1+1+0 = 5; failed = 1+0+1 = 2; rate = 2/(2+2) = 50%
    expect(html).toContain("5 claims");
    expect(html).toContain("2 completed");
    expect(html).toContain("2 failed");
    expect(html).toContain("50%");
  });
});
