import { describe, expect, it } from "vitest";
import {
  deliverableChipHtml,
  milestonesHtml,
  proposalContextHtml,
  proposalFundingBarHtml,
  proposalLifecycleBannersHtml,
  proposalShareUrl,
  proposerBylineHtml,
  shareSlotHtml,
  statusClass,
  statusLabel,
} from "./proposal-ui";
import type { Proposal, ProposalMilestone } from "./types";

describe("proposal UI critical render helpers", () => {
  it("proposerBylineHtml links site username to profile", () => {
    const html = proposerBylineHtml(
      { username: "secsovereign", github: null },
      (u) => `/u/${u}`,
    );
    expect(html).toContain(">by<");
    expect(html).toContain('href="/u/secsovereign"');
    expect(html).toContain(">secsovereign<");
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
        deliverable: "Ship checklist",
        verification: "Page loads",
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
      [{ kind: "plebly", label: "Prior", ref: "demo" }],
      [{ label: "Spec", url: "https://example.com/spec" }],
    );
    expect(html).toContain("proposal-context");
    expect(html).toContain("Depends on");
    expect(html).toContain("Related work");
    expect(html).toContain("Prior");
    expect(html).toContain("Spec");
  });

  it("funding bar stays slim without duplicate stats", () => {
    const html = proposalFundingBarHtml(50_000, 100_000, 500_000);
    expect(html).toContain("funding-meter");
    expect(html).not.toContain("proposal-stats");
  });

  it("shareSlotHtml offers copy, X, and Nostr", () => {
    const path = "proposals/listed/knots-spam-heuristics.md";
    const html = shareSlotHtml("Knots spam heuristics", path);
    expect(proposalShareUrl(path)).toContain("/proposal/");
    expect(html).toContain("proposal-share-slot");
    expect(html).toContain('data-share="copy"');
    expect(html).toContain("intent/post");
    expect(html).toContain('data-share="nostr"');
    expect(html).toContain("icon-nostr");
    expect(html).toContain("fa-x-twitter");
  });
});
