import { describe, expect, it } from "vitest";
import {
  applicationsPanelHtml,
  builderPanelHtml,
  claimerIdentityHtml,
  claimerTrackHtml,
} from "./builder-panel";
import type { ClaimApplicationsResponse, ClaimStatus } from "./builder";
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
    expect(html).toContain("Apply with bond");
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

describe("applicationsPanelHtml", () => {
  const baseApps = (): ClaimApplicationsResponse => ({
    proposal_id: "demo",
    proposal_path: "proposals/listed/demo.md",
    claim_mode: "proposer_select",
    claim_window_days: 7,
    window_started_at: new Date().toISOString(),
    window_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    decision_ends_at: new Date(Date.now() + 4 * 86_400_000).toISOString(),
    phase: "collecting",
    awarded_application_id: null,
    award_reason: null,
    summary: { total: 1, bonded: 1, pending_bond: 0 },
    applications: [
      {
        id: "app-1",
        claimer_login: "bob",
        claimer_type: "individual",
        bond_status: "bonded",
        bond_sats: 10_000,
        claim_bond_txid: "a".repeat(64),
        applied_at: new Date().toISOString(),
        bonded_at: new Date().toISOString(),
        summary: {
          active: 0,
          completed: 1,
          expired: 0,
          rejected: 0,
          abandoned: 0,
        },
      },
    ],
    collaborators: [],
    is_proposer: true,
  });

  it("shows accept/reject for proposers and mempool bond link", () => {
    const html = applicationsPanelHtml(baseApps());
    expect(html).toContain("Proposer picks");
    expect(html).toContain("data-accept-app=\"app-1\"");
    expect(html).toContain("data-reject-app=\"app-1\"");
    expect(html).toContain("Bond paid");
    expect(html).toContain("mempool.space");
    expect(html).toContain("1 completed");
  });

  it("hides accept actions for non-proposers", () => {
    const html = applicationsPanelHtml({ ...baseApps(), is_proposer: false });
    expect(html).not.toContain("data-accept-app");
  });

  it("shows first_bonded mode label and empty state", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      claim_mode: "first_bonded",
      applications: [],
      summary: { total: 0, bonded: 0, pending_bond: 0 },
      is_proposer: false,
    });
    expect(html).toContain("First bonded wins");
    expect(html).toContain("No applicants yet");
  });

  it("shows grace auto-award copy for proposers", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      phase: "grace",
      is_proposer: true,
    });
    expect(html).toContain("Auto-awards");
    expect(html).toContain("@bob");
    expect(html).toContain("unless you pick");
    expect(html).toContain("claim-grace-note");
  });

  it("shows Withdraw for the applicant's own open application", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      is_proposer: false,
      mine_application_id: "app-1",
      applications: [
        {
          ...baseApps().applications[0]!,
          is_mine: true,
        },
      ],
    });
    expect(html).toContain("data-withdraw-app=\"app-1\"");
    expect(html).toContain("(you)");
    expect(html).not.toContain("data-accept-app");
  });

  it("links org applicants to /org with avatar slot", () => {
    const html = applicationsPanelHtml({
      ...baseApps(),
      is_proposer: false,
      applications: [
        {
          ...baseApps().applications[0]!,
          claimer_login: "acme",
          claimer_type: "org",
          claim_agent: "alice",
        },
      ],
    });
    expect(html).toContain("/org/acme");
    expect(html).toContain('data-avatar-org="acme"');
    expect(html).toContain("github.com/alice");
  });
});

describe("claimerIdentityHtml", () => {
  it("builds org and user identity markup", () => {
    expect(claimerIdentityHtml("acme", "org")).toContain("/org/acme");
    expect(claimerIdentityHtml("bob", "individual")).toContain("/u/bob");
  });
});
