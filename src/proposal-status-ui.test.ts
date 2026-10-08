import { describe, expect, it } from "vitest";
import {
  proposalCurrentStep,
  proposalStepperHtml,
  statusClass,
} from "./proposal-status-ui";
import type { Proposal } from "./types";

const p = (status: string, proposal_type?: string, release_blocked_reason?: string) =>
  ({ status, proposal_type, release_blocked_reason }) as unknown as Proposal;

/** Labels in stepper order, with the current step marked by "*". */
function stepper(prop: Proposal): string[] {
  return [...proposalStepperHtml(prop).matchAll(/proposal-step-(\w+)"[^>]*>(\w+)</g)].map(
    ([, state, label]) => (state === "current" ? `*${label}` : label),
  );
}

describe("proposalCurrentStep", () => {
  it("bounty claimable is Award; direct claimable is Fund", () => {
    expect(proposalCurrentStep(p("claimable"))).toBe("Award");
    expect(proposalCurrentStep(p("claimable", "bounty"))).toBe("Award");
    expect(proposalCurrentStep(p("claimable", "direct"))).toBe("Fund");
  });

  it("listed and funding are Fund for both types", () => {
    for (const t of ["bounty", "direct"]) {
      expect(proposalCurrentStep(p("listed", t))).toBe("Fund");
      expect(proposalCurrentStep(p("funding", t))).toBe("Fund");
    }
  });

  it("pr_open, unindexed and unknown statuses are List", () => {
    for (const s of ["pr_open", "unindexed", "xyz", ""]) {
      expect(proposalCurrentStep(p(s))).toBe("List");
    }
  });

  it("release_blocked_reason wins over status", () => {
    expect(proposalCurrentStep(p("listed", "bounty", "hold"))).toBe("Release");
  });
});

describe("proposalStepperHtml", () => {
  it("bounty path has Award; direct path does not", () => {
    expect(stepper(p("listed"))).toEqual(["List", "*Fund", "Award", "Build", "Review", "Release"]);
    expect(stepper(p("listed", "direct"))).toEqual(["List", "*Fund", "Build", "Review", "Release"]);
  });

  it("rejected inserts Rebuttal after Review and marks it current", () => {
    expect(stepper(p("rejected"))).toEqual([
      "List", "Fund", "Award", "Build", "Review", "*Rebuttal", "Release",
    ]);
    expect(stepper(p("rejected", "direct"))).toEqual([
      "List", "Fund", "Build", "Review", "*Rebuttal", "Release",
    ]);
  });

  it("non-rejected paths never show Rebuttal", () => {
    expect(stepper(p("in_review"))).not.toContain("Rebuttal");
    expect(stepper(p("completed", "direct"))).not.toContain("Rebuttal");
  });
});

describe("statusClass", () => {
  it("known-but-unbucketed and unknown statuses are both neutral", () => {
    expect(statusClass("pr_open")).toBe("status-neutral");
    expect(statusClass("unindexed")).toBe("status-neutral");
    expect(statusClass("not_a_status")).toBe("status-neutral");
  });
});
