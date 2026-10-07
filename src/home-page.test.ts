import { describe, expect, it } from "vitest";
import { claimFloorShortfall } from "./builder";
import { landingMarketingHtml, listingsShareEscrow, partitionListings, proposalCardHtml, sharedEscrowNoteHtml, featuredDuplicatesOpenList } from "./home-page";
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

describe("landing marketing copy", () => {
  it("leads with one sentence and skips insider jargon", () => {
    const html = landingMarketingHtml();
    expect(html).toContain("Fund Bitcoin work in public.");
    expect(html).toContain("Browse");
    expect(html).toContain("Start a project");
    expect(html).toContain("On-chain escrow");
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
  it("warns when two listings publish the same address", () => {
    const addr = "tb1qsharedxxxxxxxxxxxxxxxxxxxxxxxxx";
    const list = [
      proposal({ status: "listed", id: "a", escrow_address: addr }),
      proposal({ status: "listed", id: "b", escrow_address: addr }),
    ];
    expect(listingsShareEscrow(list)).toBe(true);
    expect(sharedEscrowNoteHtml(list)).toContain("same pot");
  });

  it("stays quiet when addresses differ or only one listing has an address", () => {
    expect(
      listingsShareEscrow([
        proposal({ status: "listed", id: "a", escrow_address: "tb1qaaa" }),
        proposal({ status: "listed", id: "b", escrow_address: "tb1qbbb" }),
      ]),
    ).toBe(false);
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
