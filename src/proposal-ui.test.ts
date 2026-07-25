import { describe, expect, it } from "vitest";
import {
  milestonesHtml,
  proposerBylineHtml,
  statusClass,
  statusLabel,
} from "./proposal-ui";
import type { ProposalMilestone } from "./types";

describe("proposal UI critical render helpers", () => {
  it("proposerBylineHtml links site username to profile", () => {
    const html = proposerBylineHtml(
      { username: "secsovereign", github: null },
      (u) => `/u/${u}`,
    );
    expect(html).toContain("Created by");
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
  });
});
