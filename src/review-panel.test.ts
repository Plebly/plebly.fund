import { describe, expect, it } from "vitest";
import {
  aiOutcomeClass,
  aiOutcomeLabel,
  aiReviewCardHtml,
  dissentListHtml,
  reviewPanelHtml,
  rebuttalPanelHtml,
  reviewDecisionStatusLine,
} from "./review-panel";

describe("review panel UI helpers", () => {
  it("labels AI outcomes for people, not raw enums", () => {
    expect(aiOutcomeLabel("pass")).toBe("Clear pass");
    expect(aiOutcomeLabel("fail")).toBe("Clear fail");
    expect(aiOutcomeLabel("ambiguous")).toBe("Needs human review");
    expect(aiOutcomeClass("pass")).toBe("ai-pass");
  });

  it("renders AI card with failing criteria and no-ballot copy on fail", () => {
    const html = aiReviewCardHtml({
      outcome: "fail",
      reasoning: "Missing tests",
      failing_criteria: ["Acceptance criteria"],
      prompt_version: "v1",
      model: "claude-sonnet-4-20250514",
    });
    expect(html).toContain("Clear fail");
    expect(html).toContain("Missing tests");
    expect(html).toContain("Acceptance criteria");
    expect(html).toContain("Advisory");
    expect(html).toContain("AI Reviewer");
    expect(html).toContain("Powered by BTCDecoded Intelligence");
    expect(html).not.toContain("Revise and resubmit.");
    expect(html).not.toContain("AI first-pass");
    expect(html).not.toContain("No reviewer ballot");
    expect(html).not.toContain("v1");
    expect(html).not.toContain("claude-sonnet");
    expect(html).not.toMatch(/\bBDI\b/);
  });

  it("pass and ambiguous cards stay advisory", () => {
    const pass = aiReviewCardHtml({
      outcome: "pass",
      reasoning: "Looks good",
      prompt_version: "v1",
      model: "m",
    });
    expect(pass).toContain("The proposer can mark this done.");
    const amb = aiReviewCardHtml({
      outcome: "ambiguous",
      reasoning: "Unclear",
      prompt_version: "v1",
      model: "m",
    });
    expect(amb).toContain("The proposer can mark this done.");
  });

  it("review and rebuttal panels expose required controls", () => {
    const review = reviewPanelHtml("demo-id");
    expect(review).toContain('id="review-panel"');
    expect(review).toContain('id="review-actions"');
    expect(review).toContain('id="review-ai"');
    expect(review).toContain('data-proposal-id="demo-id"');
    expect(review).toContain('data-rev-vote="yes"');
    expect(review).toContain("dissent-submit");
    expect(review).toContain("Publish dissent");
    expect(review).not.toContain("dissent PR");
    expect(review).not.toContain("permanent in git");

    const rebut = rebuttalPanelHtml();
    expect(rebut).toContain("rebuttal-submit");
    expect(rebut).toContain("You can file one reply.");
    expect(rebut).not.toContain("third appeal");
    expect(rebut).not.toContain("rebuttal PR");

    const clock = rebuttalPanelHtml(
      new Date(Date.now() + 3 * 86400_000).toISOString(),
    );
    expect(clock).toMatch(/3 days left/);

    const filed = rebuttalPanelHtml(null, "The tests are in the linked repo.");
    expect(filed).toContain("Reply filed");
    expect(filed).toContain("tests are in the linked repo");
    expect(filed).not.toContain("rebuttal-submit");
  });

  it("lists published dissent without a PR link", () => {
    const html = dissentListHtml([
      {
        user_id: "github:2",
        at: "2026-01-01T00:00:00.000Z",
        reasoning: "The artifact does not match the acceptance criteria.",
      },
    ]);
    expect(html).toContain("does not match");
    expect(html).not.toContain("pull/");
    expect(html).not.toContain("github.com");
  });
});

describe("reviewDecisionStatusLine", () => {
  it("uses plain language and no spec math", () => {
    const line = reviewDecisionStatusLine({
      id: "d1",
      proposal_id: "p1",
      kind: "deliverable_confirm",
      round: 1,
      created_at: new Date().toISOString(),
      closes_at: new Date(Date.now() + 86400_000).toISOString(),
      status: "open",
      counts: { yes: 1, no: 0, abstain: 0 },
      vote_count: 1,
    });
    expect(line).toContain("Completion review");
    expect(line).not.toContain("Unpaid");
    expect(line).not.toContain("two-thirds");
    expect(line).not.toContain("⌈");
    expect(line).not.toContain("deliverable_confirm");
    expect(line).not.toContain("non-abstain");
  });
});

describe("review kind pay copy", () => {
  it("labels standard vs dispute", async () => {
    const { decisionKindPayLine } = await import("./reviewers");
    expect(decisionKindPayLine("deliverable_confirm")).toBe("Unpaid");
    expect(decisionKindPayLine("second_review")).toMatch(/10,000/);
    expect(decisionKindPayLine("listing_challenge")).toMatch(/not enabled/);
    expect(decisionKindPayLine("second_review")).not.toMatch(/insurance|pool|live/i);
  });
});
