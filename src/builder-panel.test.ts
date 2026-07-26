import { describe, expect, it } from "vitest";
import { builderPanelHtml } from "./builder-panel";
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
    expect(html).toContain("Direct funding");
    expect(html).toContain("direct-deliverable-slot");
    expect(html).not.toContain("builder-claim-modal");
    expect(html).not.toContain("Claim this project");
    expect(html).not.toContain("builder-evaluating");
  });

  it("keeps claim modal for bounty proposals", () => {
    const html = builderPanelHtml(proposal({ proposal_type: "bounty" }), 200_000, false);
    expect(html).toContain("builder-claim-modal");
    expect(html).toContain("Claim this project");
    expect(html).not.toContain("direct-deliverable-slot");
    expect(html).not.toContain("builder-evaluating");
  });

  it("uses progress copy instead of a disabled claim below floor", () => {
    const html = builderPanelHtml(proposal({ balance_sats: 1 }), 1, false);
    expect(html).toContain("Needs");
    expect(html).not.toContain('id="builder-claim" disabled');
  });
});
