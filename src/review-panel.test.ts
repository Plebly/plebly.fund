import { describe, expect, it } from "vitest";
import {
  aiOutcomeClass,
  aiOutcomeLabel,
  aiReviewCardHtml,
  reviewPanelHtml,
  rebuttalPanelHtml,
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
    expect(html).toContain("No reviewer ballot");
    expect(html).toContain("v1");
  });

  it("pass card reminds that AI never releases funds", () => {
    const html = aiReviewCardHtml({
      outcome: "pass",
      reasoning: "Looks good",
      prompt_version: "v1",
      model: "m",
    });
    expect(html).toContain("never releases funds");
  });

  it("review and rebuttal panels expose required controls", () => {
    const review = reviewPanelHtml("demo-id");
    expect(review).toContain('data-proposal-id="demo-id"');
    expect(review).toContain('data-rev-vote="yes"');
    expect(review).toContain("dissent-submit");

    const rebut = rebuttalPanelHtml();
    expect(rebut).toContain("rebuttal-submit");
    expect(rebut).toContain("14 days");
  });
});
