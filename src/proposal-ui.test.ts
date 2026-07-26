import { beforeAll, describe, expect, it } from "vitest";
import {
  canEditProposal,
  deliverableChipHtml,
  donatePanelHtml,
  metaChipsHtml,
  milestonesHtml,
  proposalContextHtml,
  proposalFundingBarHtml,
  proposalLifecycleBannersHtml,
  proposalShareUrl,
  proposerBylineHtml,
  shareSlotHtml,
  statusClass,
  statusLabel,
  statusPillHtml,
  userMatchesProposer,
} from "./proposal-ui";
import type { Proposal, ProposalMilestone } from "./types";

const locationState = {
  origin: "https://plebly.fund",
  pathname: "/p/PLEBLY-1",
  search: "",
  hash: "",
};

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: locationState },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    get: () => locationState,
    configurable: true,
  });
});

describe("proposal UI critical render helpers", () => {
  it("proposerBylineHtml links site username to profile", () => {
    const html = proposerBylineHtml(
      { username: "secsovereign", github: null },
      (u) => `/u/${u}`,
    );
    expect(html).toContain(">by<");
    expect(html).toContain('href="/u/secsovereign"');
    expect(html).toContain(">secsovereign<");
    expect(html).toContain('data-avatar-user="secsovereign"');
  });

  it("proposerBylineHtml falls back to github link", () => {
    const html = proposerBylineHtml(
      { username: null, github: "alice" },
      (u) => `/u/${u}`,
    );
    expect(html).toContain("https://github.com/alice");
  });

  it("proposerBylineHtml empty without identity", () => {
    expect(proposerBylineHtml(null, (u) => `/u/${u}`)).toBe("");
    expect(proposerBylineHtml({}, (u) => `/u/${u}`)).toBe("");
  });

  it("milestonesHtml renders rail with verify + sats total", () => {
    const milestones: ProposalMilestone[] = [
      {
        id: "m1",
        deliverable: "Ship checklist at https://example.com/check",
        verification: "Page loads via https://example.com/verify",
        out_of_scope: "Mainnet",
        allocation_sats: 50_000,
        deadline: "2026-08-15",
      },
      {
        id: "m2",
        deliverable: "Fund path",
        verification: "Balance updates",
        out_of_scope: "Multisig",
        allocation_sats: 50_000,
        deadline: "2026-09-15",
      },
    ];
    const html = milestonesHtml(milestones);
    expect(html).toContain("proposal-milestones");
    expect(html).toContain("milestone-rail");
    expect(html).toContain("Out of scope");
    expect(html).toContain("Mainnet");
    expect(html).toContain("Ship checklist");
    expect(html).toContain("Verify");
    expect(html).toContain("Page loads");
    expect(html).toContain('href="https://example.com/check"');
    expect(html).toContain('href="https://example.com/verify"');
    expect(html).toMatch(/100[,.]?000|100k/i);
  });

  it("milestonesHtml empty when no milestones", () => {
    expect(milestonesHtml([])).toBe("");
  });

  it("status helpers cover ballot/refund states", () => {
    expect(statusLabel("abandoned_vote")).toBe("abandoned vote");
    expect(statusClass("abandoned_vote")).toBe("status-active");
    expect(statusClass("refunding")).toBe("status-bad");
    expect(statusClass("underfunded")).toBe("status-bad");
    expect(statusClass("in_review")).toBe("status-active");
    expect(statusClass("rejected")).toBe("status-bad");
  });

  it("statusPillHtml hides listed", () => {
    expect(statusPillHtml("listed")).toBe("");
    expect(statusPillHtml("funding")).toContain("funding");
    expect(statusPillHtml("funding")).toContain("pill-status");
  });

  it("lifecycle banners cover in_review and rejected", () => {
    const review = proposalLifecycleBannersHtml({
      status: "in_review",
      milestones: [],
    } as Proposal);
    expect(review).toContain("In review");
    expect(review).toContain("AI first-pass");

    const rejected = proposalLifecycleBannersHtml({
      status: "rejected",
      milestones: [],
    } as Proposal);
    expect(rejected).toContain("Rejected");
    expect(rejected).toContain("rebuttal");
  });

  it("lifecycle banners cover direct delivery window expiry", () => {
    const expired = new Date(Date.now() - 86400_000).toISOString();
    const html = proposalLifecycleBannersHtml({
      status: "listed",
      proposal_type: "direct",
      delivery_window_ends_at: expired,
      milestones: [],
    } as Proposal);
    expect(html).toContain("Delivery window");
    expect(html).toContain("Window ended");
  });

  it("donate panel is a credit-then-pay wizard", () => {
    const signedOut = donatePanelHtml({
      escrow_address: "tb1qtest",
    } as Proposal);
    expect(signedOut).toContain('id="donate-step-credit"');
    expect(signedOut).toContain('id="donate-step-pay"');
    expect(signedOut).toContain("Continue anonymously");
    expect(signedOut).toContain("Sign in");
    expect(signedOut).not.toContain("donate-credit-public");

    const signedIn = donatePanelHtml(
      { escrow_address: "tb1qtest" } as Proposal,
      { signedIn: true },
    );
    expect(signedIn).toContain("donate-credit-public");
    expect(signedIn).toContain("donate-credit-amount");
    expect(signedIn).toContain("Continue to payment");
    expect(signedIn).toContain("Change credit preferences");
  });

  it("meta chips show type and tags", () => {
    const html = metaChipsHtml({
      id: "PLEBLY-1",
      proposal_type: "direct",
      tags: ["knots", "policy"],
      created_at: null,
    } as Proposal);
    expect(html).toContain("Direct");
    expect(html).toContain("knots");
    expect(html).toContain("policy");
    expect(html).toContain("PLEBLY-1");
  });

  it("userMatchesProposer / canEditProposal identity gates", () => {
    const proposer = { username: "alice", github: "alice-gh" };
    expect(
      userMatchesProposer({ username: "alice" }, proposer),
    ).toBe(true);
    expect(
      userMatchesProposer({ github: "alice-gh" }, proposer),
    ).toBe(true);
    expect(userMatchesProposer({ username: "bob" }, proposer)).toBe(false);
    expect(canEditProposal({ username: "alice" }, proposer, "listed")).toBe(
      true,
    );
    expect(canEditProposal({ username: "alice" }, proposer, "claimed")).toBe(
      false,
    );
  });

  it("deliverableChipHtml only accepts https URLs", () => {
    expect(deliverableChipHtml("http://insecure.example")).toBe("");
    expect(deliverableChipHtml("https://example.com/out")).toContain(
      "example.com/out",
    );
  });

  it("milestonesHtml tucks verify/oos behind details", () => {
    const html = milestonesHtml([
      {
        id: "m1",
        deliverable: "Ship checklist",
        verification: "Page loads",
        out_of_scope: "Mainnet",
        allocation_sats: 50_000,
        deadline: "2026-08-15",
      },
    ]);
    expect(html).toContain("milestone-more");
    expect(html).toContain("<summary>Details</summary>");
  });

  it("proposalContextHtml merges deps and related work", () => {
    const html = proposalContextHtml(
      [
        {
          kind: "external",
          label: "Prior",
          ref: "https://example.com/dep",
          note: "See also https://example.com/note",
        },
      ],
      [
        {
          label: "Spec",
          url: "https://example.com/spec",
          note: "Background at https://example.com/bg",
        },
      ],
    );
    expect(html).toContain("proposal-context");
    expect(html).toContain("Depends on");
    expect(html).toContain("Related work");
    expect(html).toContain("Prior");
    expect(html).toContain("Spec");
    expect(html).toContain('href="https://example.com/dep"');
    expect(html).toContain('href="https://example.com/spec"');
    expect(html).toContain('href="https://example.com/note"');
    expect(html).toContain('href="https://example.com/bg"');
  });

  it("funding bar stays slim without duplicate stats", () => {
    const html = proposalFundingBarHtml(50_000, 100_000, 500_000);
    expect(html).toContain("funding-meter");
    expect(html).not.toContain("proposal-stats");
  });

  it("shareSlotHtml offers copy, X, and Nostr", () => {
    const path = "proposals/listed/knots-spam-heuristics.md";
    const html = shareSlotHtml("Knots spam heuristics", path, "PLEBLY-42");
    expect(proposalShareUrl(path, "PLEBLY-42")).toContain("/p/PLEBLY-42");
    expect(html).toContain("proposal-share-slot");
    expect(html).toContain('data-share="copy"');
    expect(html).toContain("intent/post");
    expect(html).toContain('data-share="nostr"');
    expect(html).toContain("icon-nostr");
    expect(html).toContain("fa-x-twitter");
  });
});
