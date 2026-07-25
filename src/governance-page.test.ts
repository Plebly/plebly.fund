import { describe, expect, it } from "vitest";
import {
  decisionCardHtml,
  openDecisionsHtml,
  openRemovalFormHtml,
  openRemovalsHtml,
  removalCardHtml,
  reviewerRowHtml,
  rosterSectionHtml,
} from "./governance-page";
import {
  decisionKindLabel,
  shortUserId,
} from "./reviewers";

describe("governance UI helpers", () => {
  it("shortens provider-prefixed user ids", () => {
    expect(shortUserId("github:12345")).toBe("gh:12345");
    expect(shortUserId("x:99")).toBe("x:99");
  });

  it("labels decision kinds", () => {
    expect(decisionKindLabel("deliverable_confirm")).toBe("Deliverable confirm");
    expect(decisionKindLabel("second_review")).toBe("Second review");
  });

  it("renders roster rows and select for earned seats", () => {
    const earned = reviewerRowHtml(
      {
        user_id: "github:2",
        kind: "earned",
        status: "active",
        seated_at: "2026-01-01T00:00:00.000Z",
        completed_count: 3,
        completed_proposal_ids: [],
      },
      true,
    );
    expect(earned).toContain("gov-select-target");
    expect(earned).toContain("Earned");
    expect(earned).not.toContain("disabled");

    const boot = reviewerRowHtml(
      {
        user_id: "github:1",
        kind: "bootstrap",
        status: "active",
        seated_at: "2026-01-01T00:00:00.000Z",
        completed_count: 0,
        completed_proposal_ids: [],
      },
      true,
    );
    expect(boot).toContain("disabled");
    expect(boot).toContain("Bootstrap");
  });

  it("roster section shows counts", () => {
    const html = rosterSectionHtml({
      active: ["github:1"],
      reviewers: [
        {
          user_id: "github:1",
          kind: "bootstrap",
          status: "active",
          seated_at: "2026-01-01T00:00:00.000Z",
          completed_count: 0,
          completed_proposal_ids: [],
        },
      ],
      count: 1,
      platform_completions: 4,
    });
    expect(html).toContain("1 active");
    expect(html).toContain("Platform completions 4");
  });

  it("decision cards expose vote controls for reviewers", () => {
    const d = {
      id: "dec-1",
      proposal_id: "demo",
      proposal_path: "proposals/claimed/demo.md",
      kind: "deliverable_confirm",
      round: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      closes_at: "2026-01-15T00:00:00.000Z",
      status: "open",
      counts: { yes: 1, no: 0, abstain: 0 },
      vote_count: 1,
      roster_size: 5,
      need_yes: 4,
    };
    const html = decisionCardHtml(d, true);
    expect(html).toContain('data-dec-vote="yes"');
    expect(html).toContain("demo");
    expect(openDecisionsHtml([], false)).toContain("No open decisions");
  });

  it("removal cards and open form gate on funder eligibility", () => {
    const ballot = {
      id: "rem-1",
      target_user_id: "github:9",
      initiator_user_id: "github:3",
      evidence: "Pattern across two bad-faith decisions with cites.",
      created_at: "2026-01-01T00:00:00.000Z",
      closes_at: "2026-01-15T00:00:00.000Z",
      status: "open",
      vote_count: 0,
      counts: { yes: 0, no: 0 },
    };
    expect(removalCardHtml(ballot, true)).toContain('data-rem-vote="yes"');
    expect(removalCardHtml(ballot, false)).toContain("eligible funder");
    expect(openRemovalsHtml([], false)).toContain("No open removal ballots");

    const form = openRemovalFormHtml(
      {
        active: false,
        funder_eligible: true,
        removal_min_sats: 10_000,
        reviewer: null,
      },
      true,
    );
    expect(form).toContain("removal-open-form");
    expect(form).toContain("removal-evidence");

    const blocked = openRemovalFormHtml(
      {
        active: false,
        funder_eligible: false,
        removal_min_sats: 10_000,
        reviewer: null,
      },
      true,
    );
    expect(blocked).toContain("confirmed contribution");
    expect(blocked).not.toContain("removal-open-form");
  });
});
