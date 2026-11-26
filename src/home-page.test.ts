import { describe, expect, it } from "vitest";
import { claimFloorShortfall } from "./builder";
import { browseSortSearch, gapTickerHtml, landingMarketingHtml, partitionListings, proposalCardHtml, sharedEscrowNoteHtml, featuredDuplicatesOpenList, sortProposals } from "./home-page";
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

  it("does not count a direct-builder bounty as waiting on a pot", () => {
    const out = claimFloorShortfall(
      [
        proposal({
          status: "listed",
          balance_sats: 0,
          funding_route: "direct-builder",
          id: "direct",
        }),
      ],
      10_000,
    );
    expect(out.projectCount).toBe(0);
    expect(gapTickerHtml(
      [
        proposal({
          status: "listed",
          balance_sats: 0,
          funding_route: "direct-builder",
          id: "direct",
        }),
      ],
      10_000,
    )).toContain("Ready for builders");
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

describe("gapTickerHtml", () => {
  it("names the shortfall for a single project below the floor", () => {
    const html = gapTickerHtml(
      [proposal({ status: "listed", balance_sats: 2_500, id: "one" })],
      10_000,
    );
    expect(html).toContain("1 project still needs funding before applications open");
    expect(html).not.toContain("still raising before builders can apply");
  });

  it("uses plural funding copy when several projects are short", () => {
    const html = gapTickerHtml(
      [
        proposal({ status: "listed", balance_sats: 2_000, id: "a" }),
        proposal({ status: "funding", balance_sats: 8_000, id: "b" }),
      ],
      10_000,
    );
    expect(html).toContain("2 projects still need funding before applications open");
    expect(html).toContain("10,000 sats");
  });
});

describe("landing marketing copy", () => {
  it("leads with one sentence and skips insider jargon", () => {
    const html = landingMarketingHtml();
    expect(html).toContain("Fund Bitcoin work in public.");
    expect(html).toContain("Browse");
    expect(html).toContain("Start a project");
    expect(html).toContain("Pay the builder");
    expect(html).toContain("A gift is final");
    expect(html).toContain("Funders get a window to flag the work, and reviewers vote only if it's flagged. Payment goes out monthly.");
    expect(html).not.toContain("Reviewers check the work");
    expect(html).not.toContain("On-chain escrow");
    expect(html).not.toContain("5% when paid");
    expect(html).not.toContain("Protocol over platform");
    expect(html).not.toContain("funding loop");
    expect(html).not.toContain("How Plebly works");
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

describe("featuredDuplicatesOpenList", () => {
  it("hides featured when it is the whole open bounty list", () => {
    const open = [
      proposal({ status: "listed", id: "a" }),
      proposal({ status: "listed", id: "b" }),
    ];
    expect(featuredDuplicatesOpenList(open, open)).toBe(true);
    expect(featuredDuplicatesOpenList(open.slice(0, 1), open)).toBe(false);
  });
});

describe("shared escrow note", () => {
  const NOTE =
    "These test listings share one escrow address. Each balance counts only that listing's own confirmed funding, so a block explorer will show a higher total for the address.";

  it("shows when the catalog marks a listing escrow_shared, with no live-region role", () => {
    const html = sharedEscrowNoteHtml([
      proposal({ status: "listed", id: "a", escrow_address: "tb1qshared", escrow_shared: true }),
      proposal({ status: "listed", id: "b", escrow_address: "tb1qother" }),
    ]);
    expect(html).toContain(NOTE);
    expect(html).not.toContain("role=");
  });

  it("follows escrow_shared, not address equality", () => {
    const addr = "tb1qsharedxxxxxxxxxxxxxxxxxxxxxxxxx";
    // Same address but catalog did not flag it: quiet.
    expect(
      sharedEscrowNoteHtml([
        proposal({ status: "listed", id: "a", escrow_address: addr }),
        proposal({ status: "listed", id: "b", escrow_address: addr }),
      ]),
    ).toBe("");
    expect(
      sharedEscrowNoteHtml([
        proposal({ status: "listed", id: "a", escrow_address: "tb1qonly" }),
      ]),
    ).toBe("");
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

  it("shows the maker's latest update title when one exists", () => {
    const html = proposalCardHtml(
      proposal({ status: "listed", id: "PLEBLY-2026-003" }),
      10_000,
      false,
      false,
      new Map([["PLEBLY-2026-003", { title: "Shipped the rehearsal", created_at: "2026-11-25T00:00:00.000Z" }]]),
    );
    expect(html).toContain("project-card-update");
    expect(html).toContain("Update");
    expect(html).toContain("Shipped the rehearsal");
    expect(html).not.toContain("2 updates");
    const counted = proposalCardHtml(
      proposal({ status: "listed", id: "PLEBLY-2026-003" }),
      10_000,
      false,
      false,
      new Map([["PLEBLY-2026-003", { title: "Shipped the rehearsal", created_at: "2026-11-25T00:00:00.000Z", count: 2 }]]),
    );
    expect(counted).toContain("2 updates");
    expect(
      proposalCardHtml(proposal({ status: "listed", id: "PLEBLY-2026-003" }), 10_000, false, false),
    ).not.toContain("project-card-update");
  });
});

describe("browseSortSearch", () => {
  it("keeps the other filters and drops the default sort", () => {
    expect(browseSortSearch("?size=below-floor&type=direct", "updated")).toBe(
      "?size=below-floor&type=direct&sort=updated",
    );
    expect(browseSortSearch("?sort=updated&size=below-floor", "funded")).toBe(
      "?size=below-floor",
    );
  });
});

describe("sortProposals updated", () => {
  it("puts projects with a maker update ahead of projects without one", () => {
    const quiet = proposal({ status: "listed", id: "quiet", created_at: "2026-11-20T00:00:00.000Z" });
    const fresh = proposal({ status: "listed", id: "fresh", created_at: "2026-01-01T00:00:00.000Z" });
    const older = proposal({ status: "listed", id: "older", created_at: "2026-11-01T00:00:00.000Z" });
    const latest = new Map([
      ["FRESH", { title: "Now", created_at: "2026-11-25T00:00:00.000Z", count: 1 }],
      ["OLDER", { title: "Then", created_at: "2026-11-10T00:00:00.000Z", count: 3 }],
    ]);
    expect(sortProposals([quiet, older, fresh], "updated", 10_000, latest).map((p) => p.id)).toEqual([
      "fresh",
      "older",
      "quiet",
    ]);
  });
});

describe("proposalCardHtml settle txid chrome", () => {
  it("shows settle txid chip with explorer link when settle_txid is present", () => {
    const txid = "abcdef01" + "23".repeat(28);
    const html = proposalCardHtml(
      proposal({
        status: "in_review",
        settle_txid: txid,
      }),
      10_000,
      false,
      false,
    );
    expect(html).toContain("project-card-settle");
    expect(html).toContain("Settle:");
    expect(html).toContain("abcdef01");
    expect(html).toContain(`/tx/${txid}`);
  });

  it("hides settle txid chip when settle_txid is missing", () => {
    const html = proposalCardHtml(
      proposal({
        status: "in_review",
        settle_txid: null,
      }),
      10_000,
      false,
      false,
    );
    expect(html).not.toContain("project-card-settle");
    expect(html).not.toContain("Settle:");
  });

  it("hides settle txid chip when txid is invalid (not 64 hex)", () => {
    const html = proposalCardHtml(
      proposal({
        status: "in_review",
        settle_txid: "short",
      }),
      10_000,
      false,
      false,
    );
    expect(html).not.toContain("project-card-settle");
  });

  it("shows settle txid for completed projects with settle", () => {
    const txid = "deadbeef" + "ff".repeat(28);
    const html = proposalCardHtml(
      proposal({
        status: "completed",
        settle_txid: txid,
      }),
      10_000,
      false,
      false,
    );
    expect(html).toContain("project-card-settle");
    expect(html).toContain("deadbeef");
  });
});

describe("proposalCardHtml uses View link (not embedded Donate)", () => {
  it("shows View link and no Donate for voided proposals", () => {
    const html = proposalCardHtml(
      proposal({
        status: "voided",
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(html).not.toContain("Donate");
    expect(html).not.toContain("project-donate-btn");
    expect(html).toContain("View");
    expect(html).toContain("project-view-btn");
  });

  it("shows Voided status badge for voided proposals", () => {
    const html = proposalCardHtml(
      proposal({
        status: "voided",
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(html).toContain("Voided");
    expect(html).toContain("status-bad");
  });

  it("shows Unavailable badge for unknown status", () => {
    const html = proposalCardHtml(
      proposal({
        status: "some_unknown_future_status",
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(html).toContain("Unavailable");
    expect(html).toContain("status-neutral");
  });

  it("always uses View link regardless of accepting_funds", () => {
    const htmlBlocked = proposalCardHtml(
      proposal({
        status: "listed",
        accepting_funds: false,
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(htmlBlocked).not.toContain("Donate");
    expect(htmlBlocked).toContain("View");
    expect(htmlBlocked).toContain("project-view-btn");

    const htmlAllowed = proposalCardHtml(
      proposal({
        status: "listed",
        accepting_funds: true,
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(htmlAllowed).not.toContain("Donate");
    expect(htmlAllowed).toContain("View");
    expect(htmlAllowed).toContain("project-view-btn");
  });

  it("always uses View link regardless of structured_state", () => {
    const htmlVoided = proposalCardHtml(
      proposal({
        status: "listed",
        structured_state: "voided",
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(htmlVoided).toContain("View");
    expect(htmlVoided).not.toContain("project-donate-btn");

    const htmlHealthy = proposalCardHtml(
      proposal({
        status: "listed",
        structured_state: "awaiting_funds",
        escrow_address: "bc1qtest",
      }),
      10_000,
      false,
      false,
    );
    expect(htmlHealthy).toContain("View");
    expect(htmlHealthy).not.toContain("project-donate-btn");
  });
});
