import { describe, expect, it } from "vitest";
import { claimFloorShortfall } from "./builder";
import { partitionListings, proposalCardHtml } from "./home-page";
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

describe("partitionListings", () => {
  it("splits bounties from direct campaigns", () => {
    const { bounties, campaigns } = partitionListings([
      proposal({ status: "listed", proposal_type: "bounty", id: "b1" }),
      proposal({ status: "listed", proposal_type: "direct", id: "c1" }),
      proposal({ status: "funding", id: "b2" }),
    ]);
    expect(bounties.map((p) => p.id)).toEqual(["b1", "b2"]);
    expect(campaigns.map((p) => p.id)).toEqual(["c1"]);
  });
});

describe("proposalCardHtml lightning badge", () => {
  it("marks listed projects when Lightning is live", () => {
    const html = proposalCardHtml(
      proposal({
        status: "listed",
        escrow_address: "bc1qescrowxxxxxxxxxxxxxxxxxxxxxxxxxx",
      }),
      10_000,
      true,
      false,
    );
    expect(html).toContain("project-card-ln");
    expect(html).toContain("Lightning");
  });

  it("hides the badge when Lightning is off", () => {
    const html = proposalCardHtml(
      proposal({
        status: "listed",
        escrow_address: "bc1qescrowxxxxxxxxxxxxxxxxxxxxxxxxxx",
      }),
      10_000,
      false,
      false,
    );
    expect(html).not.toContain("project-card-ln");
  });
});
