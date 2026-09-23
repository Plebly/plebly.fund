import { describe, expect, it } from "vitest";
import {
  aiOutcomeClass,
  aiOutcomeLabel,
  aiReviewCardHtml,
  closedBallotSummary,
  dissentListHtml,
  FULFILLER_CANNOT_VOTE,
  isAiChallengeableDecision,
  challengeAiButtonLabel,
  reviewPanelHtml,
  rebuttalPanelHtml,
  reviewDecisionStatusLine,
  suppressFlagForClosedBallot,
} from "./review-panel";
import type { ReviewDecisionView } from "./reviewers";

describe("review panel UI helpers", () => {
  it("labels AI outcomes for people, not raw enums", () => {
    expect(aiOutcomeLabel("pass")).toBe("Clear pass");
    expect(aiOutcomeLabel("fail")).toBe("Clear fail");
    expect(aiOutcomeLabel("ambiguous")).toBe("Needs human review");
    expect(aiOutcomeClass("pass")).toBe("ai-pass");
  });

  it("renders AI card with failing criteria and hybrid vote copy on fail", () => {
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
    expect(html).toContain("decisive vote");
    expect(html).toContain("AI Reviewer");
    expect(html).toContain("Powered by BTCDecoded Intelligence");
    expect(html).not.toContain("Advisory");
    expect(html).not.toContain("Revise and resubmit.");
    expect(html).not.toContain("AI first-pass");
    expect(html).not.toContain("No reviewer ballot");
    expect(html).not.toContain("v1");
    expect(html).not.toContain("claude-sonnet");
    expect(html).not.toMatch(/\bBDI\b/);
  });

  it("shows an unscored cite pack as needing humans", () => {
    const html = aiReviewCardHtml({
      outcome: "fail",
      reasoning:
        "github · prs_raw.jsonl:35164:2026-07-24:musaHaruna\nmusaHaruna on #35164 thank you",
      prompt_version: "intel-mcp-v1",
      model: "jev-latest",
    });
    expect(html).toContain("Needs human review");
    expect(html).toContain("did not score this work");
    expect(html).not.toContain("musaHaruna");
    expect(html).not.toContain("Clear fail");
    expect(html).not.toContain("decisive vote");
  });

  it("pass is hybrid decisive; ambiguous escalates to humans", () => {
    const pass = aiReviewCardHtml({
      outcome: "pass",
      reasoning: "Looks good",
      prompt_version: "v1",
      model: "m",
    });
    expect(pass).toContain("decisive vote");
    expect(pass).not.toContain("Advisory");
    const amb = aiReviewCardHtml({
      outcome: "ambiguous",
      reasoning: "Unclear",
      prompt_version: "v1",
      model: "m",
    });
    expect(amb).toContain("Needs humans");
    expect(amb).toContain("Escalate");
  });

  it("review and rebuttal panels expose required controls", () => {
    const review = reviewPanelHtml("demo-id");
    expect(review).toContain('id="review-panel"');
    expect(review).toContain('id="review-actions"');
    expect(review).toContain('id="review-ai"');
    expect(review).toContain('id="review-challenge-ai"');
    expect(review).toContain('id="challenge-ai-submit"');
    expect(review).toContain("Challenge AI");
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

  it("surfaces escalated to humans on open ballots", () => {
    const line = reviewDecisionStatusLine({
      id: "d1",
      proposal_id: "p1",
      kind: "deliverable_confirm",
      round: 1,
      created_at: new Date().toISOString(),
      closes_at: new Date(Date.now() + 86400_000).toISOString(),
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
      escalated: true,
    });
    expect(line).toContain("Escalated to humans");
  });
});

describe("isAiChallengeableDecision", () => {
  const base = (): ReviewDecisionView => ({
    id: "d1",
    proposal_id: "p1",
    kind: "deliverable_confirm",
    round: 1,
    created_at: new Date().toISOString(),
    closes_at: new Date(Date.now() + 86400_000).toISOString(),
    status: "open",
    counts: { yes: 0, no: 0, abstain: 0 },
    vote_count: 0,
  });

  it("allows open deliverable_confirm / second_review before escalate", () => {
    expect(isAiChallengeableDecision(base())).toBe(true);
    expect(
      isAiChallengeableDecision({ ...base(), kind: "second_review" }),
    ).toBe(true);
  });

  it("allows tallied ai_decisive so Challenge AI can reopen after grace", () => {
    expect(
      isAiChallengeableDecision({
        ...base(),
        status: "tallied",
        ai_decisive: true,
        result: "reject",
      }),
    ).toBe(true);
  });

  it("allows closed/tallied ai_decisive (status-line Closed · AI decisive)", () => {
    expect(
      isAiChallengeableDecision({
        ...base(),
        status: "closed",
        ai_decisive: true,
        result: "reject",
      }),
    ).toBe(true);
    expect(
      isAiChallengeableDecision({
        ...base(),
        status: "tallied",
        ai_decisive: true,
        result: "reject",
      }),
    ).toBe(true);
  });

  it("hides when not ai_decisive closed, wrong kind, or already escalated/challenged", () => {
    expect(isAiChallengeableDecision({ ...base(), status: "closed" })).toBe(
      false,
    );
    expect(
      isAiChallengeableDecision({ ...base(), kind: "listing_challenge" }),
    ).toBe(false);
    expect(isAiChallengeableDecision({ ...base(), escalated: true })).toBe(
      false,
    );
    expect(
      isAiChallengeableDecision({
        ...base(),
        status: "tallied",
        ai_decisive: true,
        escalated: true,
      }),
    ).toBe(false);
    expect(
      isAiChallengeableDecision({
        ...base(),
        ai_challenged_at: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe("challengeAiButtonLabel", () => {
  it("says Challenged only when ai_challenged_at is set", () => {
    expect(
      challengeAiButtonLabel({
        id: "d1",
        proposal_id: "p1",
        kind: "deliverable_confirm",
        round: 1,
        created_at: new Date().toISOString(),
        closes_at: new Date().toISOString(),
        status: "tallied",
        counts: { yes: 0, no: 1, abstain: 0 },
        vote_count: 1,
        ai_decisive: true,
      }),
    ).toBe("Challenge AI");
    expect(
      challengeAiButtonLabel({
        id: "d1",
        proposal_id: "p1",
        kind: "deliverable_confirm",
        round: 1,
        created_at: new Date().toISOString(),
        closes_at: new Date().toISOString(),
        status: "open",
        counts: { yes: 0, no: 0, abstain: 0 },
        vote_count: 0,
        ai_challenged_at: new Date().toISOString(),
      }),
    ).toBe("Challenged");
  });
});

describe("reviewPanelHtml challenge placement", () => {
  it("places Challenge AI above the AI reasoning slot", () => {
    const html = reviewPanelHtml("demo-id");
    const chal = html.indexOf('id="review-challenge-ai"');
    const ai = html.indexOf('id="review-ai"');
    expect(chal).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(-1);
    expect(chal).toBeLessThan(ai);
  });

  it("truncates compact AI reasoning so Challenge stays in viewport", () => {
    const long = "x".repeat(500);
    const html = aiReviewCardHtml(
      { outcome: "fail", reasoning: long, failing_criteria: ["acceptance"], prompt_version: "v1", model: "m" },
      { compact: true },
    );
    expect(html).toContain("…");
    expect(html).not.toContain(long);
    expect(html).toContain("is-compact");
  });
});

describe("review kind pay copy", () => {
  it("labels standard vs dispute", async () => {
    const { decisionKindPayLine } = await import("./reviewers");
    expect(decisionKindPayLine("deliverable_confirm")).toBe(
      "Share of the 2% reviewer reserve when the review finishes",
    );
    expect(decisionKindPayLine("second_review")).toBe(
      "Share of the 2% reviewer reserve when the review finishes",
    );
    expect(decisionKindPayLine("listing_challenge")).toMatch(/not enabled/);
    expect(decisionKindPayLine("claim_extension")).toMatch(/not enabled/);
  });
});


describe("closed ballot / fulfiller copy", () => {
  it("closedBallotSummary is the sole primary state line", () => {
    expect(
      closedBallotSummary({
        id: "d1",
        proposal_id: "p1",
        kind: "deliverable_confirm",
        round: 1,
        created_at: "2026-01-01T00:00:00Z",
        closes_at: "2026-01-02T00:00:00Z",
        status: "closed",
        counts: { yes: 3, no: 0, abstain: 0 },
        vote_count: 3,
        passed: true,
        result: "approve",
      }),
    ).toBe("Closed — approve (passed)");
  });

  it("suppressFlagForClosedBallot removes Flag CTA", () => {
    document.body.innerHTML = `
      <p id="next-card-sentence">Flag if the work is not finished. 7 days left.</p>
      <div class="next-card-primary"><button type="button" class="btn" id="builder-flag">Flag this close</button></div>`;
    suppressFlagForClosedBallot(document.body, {
      id: "d1",
      proposal_id: "p1",
      kind: "deliverable_confirm",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-01-02T00:00:00Z",
      status: "closed",
      counts: { yes: 3, no: 0, abstain: 0 },
      vote_count: 3,
      passed: true,
      result: "approve",
    });
    expect(document.querySelector("#builder-flag")).toBeNull();
    expect(document.querySelector("#next-card-sentence")?.textContent).toBe(
      "Closed — approve (passed)",
    );
  });

  it("fulfiller cannot-vote copy is fixed", () => {
    expect(FULFILLER_CANNOT_VOTE).toContain("fulfiller");
    expect(FULFILLER_CANNOT_VOTE).toContain("cannot vote");
  });
});
