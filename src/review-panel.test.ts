import { describe, expect, it } from "vitest";
import {
  aiOutcomeClass,
  aiOutcomeLabel,
  aiReviewCardHtml,
  claimAllowsClosedBallotListingChrome,
  closedBallotSummary,
  dissentListHtml,
  flaggedDisputedListingLabel,
  FULFILLER_CANNOT_VOTE,
  isAiChallengeableDecision,
  isDemotedAiOutcome,
  challengeAiButtonLabel,
  listingBallotStatusLabel,
  primaryBallotStatusLabel,
  renderDecision,
  reviewPanelHtml,
  rebuttalPanelHtml,
  reviewDecisionStatusLine,
  reapplyListingBallotChrome,
  suppressFlagForClosedBallot,
  syncListingBallotChrome,
} from "./review-panel";
import { statusPillHtml } from "./proposal-ui";
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

  function openDecision(kind: string): ReviewDecisionView {
    return {
      id: "d-open",
      proposal_id: "p1",
      kind,
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-01-08T00:00:00Z",
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
    };
  }

  function mountReviewPanel(): HTMLElement {
    document.body.innerHTML = reviewPanelHtml("p1");
    return document.body.querySelector("#review-panel")!;
  }

  it("blocks fulfiller on open claim_extension (not only deliverable kinds)", () => {
    const panel = mountReviewPanel();
    renderDecision(panel, openDecision("claim_extension"), true, "github:1", true);
    const actions = panel.querySelector("#review-actions")!;
    expect(actions.hidden).toBe(false);
    expect(actions.textContent).toContain(FULFILLER_CANNOT_VOTE);
    expect(panel.querySelectorAll("[data-rev-vote]")).toHaveLength(0);
    expect(panel.querySelector("#review-dissent")?.hidden).toBe(true);
  });

  it("blocks fulfiller on open listing_challenge", () => {
    const panel = mountReviewPanel();
    renderDecision(panel, openDecision("listing_challenge"), true, "github:1", true);
    expect(panel.querySelector("#review-actions")?.textContent).toContain(
      FULFILLER_CANNOT_VOTE,
    );
    expect(panel.querySelectorAll("[data-rev-vote]")).toHaveLength(0);
  });

  it("still blocks fulfiller on open deliverable_confirm", () => {
    const panel = mountReviewPanel();
    renderDecision(panel, openDecision("deliverable_confirm"), true, "github:1", true);
    expect(panel.querySelector("#review-actions")?.textContent).toContain(
      FULFILLER_CANNOT_VOTE,
    );
    expect(panel.querySelectorAll("[data-rev-vote]")).toHaveLength(0);
  });

  it("non-fulfiller reviewer still sees open vote buttons", () => {
    const panel = mountReviewPanel();
    renderDecision(panel, openDecision("claim_extension"), true, "github:2", false);
    const actions = panel.querySelector("#review-actions")!;
    expect(actions.hidden).toBe(false);
    expect(actions.textContent).not.toContain(FULFILLER_CANNOT_VOTE);
    expect(panel.querySelectorAll("[data-rev-vote]").length).toBeGreaterThanOrEqual(3);
    expect(panel.querySelector("#review-dissent")?.hidden).toBe(false);
  });

  it("open ballot keeps Flag CTA (closed suppress only)", () => {
    document.body.innerHTML = `
      ${reviewPanelHtml("p1")}
      <p id="next-card-sentence">Flag if the work is not finished. 7 days left.</p>
      <div class="next-card-primary"><button type="button" class="btn" id="builder-flag">Flag this close</button></div>`;
    suppressFlagForClosedBallot(document.body, openDecision("claim_extension"));
    expect(document.querySelector("#builder-flag")).not.toBeNull();
    expect(document.querySelector("#next-card-sentence")?.textContent).toContain(
      "Flag if the work",
    );
  });
});


describe("listing ballot status chrome", () => {
  it("primaryBallotStatusLabel unifies open extension and closed tallies", () => {
    expect(
      primaryBallotStatusLabel({
        id: "d1",
        proposal_id: "p1",
        kind: "claim_extension",
        round: 1,
        created_at: "2026-01-01T00:00:00Z",
        closes_at: "2026-10-07T00:00:00Z",
        status: "open",
        counts: { yes: 0, no: 0, abstain: 0 },
        vote_count: 0,
        escalated: true,
      }),
    ).toBe("Time extension — open");
    expect(
      primaryBallotStatusLabel({
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

  it("open status line leads with primary and keeps escalate/closes detail", () => {
    const line = reviewDecisionStatusLine({
      id: "d1",
      proposal_id: "p1",
      kind: "claim_extension",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-10-07T00:00:00Z",
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
      escalated: true,
    });
    expect(line.startsWith("Time extension — open")).toBe(true);
    expect(line).toContain("Escalated to humans");
    expect(line).toContain("closes");
    expect(line).not.toContain("Review is open");
  });

  it("syncListingBallotChrome paints one label across header/sidebar", () => {
    document.body.innerHTML = `
      <div class="proposal-hero-top"><span class="pill-status">In review</span></div>
      <div class="proposal-funding-bar"><span class="funding-meter-label">In review</span></div>
      <a id="review-side-link" href="#proposal-review">Review is open</a>
      <p id="next-card-sentence">Vote whether this meets the project.</p>
      <p id="next-card-detail" class="muted">extra</p>`;
    syncListingBallotChrome(document.body, {
      id: "d1",
      proposal_id: "p1",
      kind: "claim_extension",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-10-07T00:00:00Z",
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
      escalated: true,
    });
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector(".funding-meter-label")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector("#review-side-link")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector("#next-card-sentence")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector("#next-card-detail")).toBeNull();
    expect(
      (document.querySelector("#review-side-link") as HTMLElement).dataset
        .ballotChrome,
    ).toBe("1");
  });

  it("tucks skipped AI cards so they do not compete with the ballot", () => {
    expect(isDemotedAiOutcome("bypass")).toBe(true);
    expect(isDemotedAiOutcome("unavailable")).toBe(true);
    expect(isDemotedAiOutcome("pass")).toBe(false);
    const html = aiReviewCardHtml({
      outcome: "bypass",
      reasoning: "AI Reviewer skipped: listing tags are outside competence.",
    });
    expect(html).toContain("<details");
    expect(html).toContain("is-tucked");
    expect(html).toContain("Skipped");
    expect(html).not.toContain("decisive vote");
  });

  it("reapply after refreshStepper-style pill clobber keeps Time extension primary", () => {
    document.body.innerHTML = `
      <div class="proposal-hero-top"><span class="pill-status">In review</span></div>
      <div class="proposal-funding-bar"><span class="funding-meter-label">In review</span></div>
      <a id="review-side-link" href="#proposal-review">Review is open</a>
      <p id="next-card-sentence">Vote whether this meets the project.</p>
      <div id="review-panel"></div>`;
    const decision = {
      id: "d-ext-1",
      proposal_id: "p1",
      kind: "claim_extension",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-10-07T00:00:00Z",
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
      escalated: true,
    };
    syncListingBallotChrome(document.body, decision);
    const panel = document.querySelector("#review-panel") as HTMLElement;
    panel.dataset.reviewDecisionId = decision.id;
    panel.dataset.reviewDecisionStatus = decision.status;

    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Time extension — open",
    );
    expect(
      (document.querySelector(".pill-status") as HTMLElement).dataset.ballotChrome,
    ).toBe("1");

    // Simulate builder-panel refreshStepper lifecycle overwrite.
    const pillHost = document.querySelector(".proposal-hero-top")!;
    const prev = pillHost.querySelector(".pill-status");
    const next = statusPillHtml("in_review");
    if (prev && next) prev.outerHTML = next;
    expect(document.querySelector(".pill-status")?.textContent).toBe("In review");

    reapplyListingBallotChrome(document.body);
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector(".funding-meter-label")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector("#review-side-link")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector("#next-card-sentence")?.textContent).toBe(
      "Time extension — open",
    );
    expect(document.querySelector(".pill-status")?.textContent).not.toBe(
      "In review",
    );
  });

  it("ballotChrome mark lets callers skip lifecycle pill overwrite", () => {
    document.body.innerHTML = `
      <div class="proposal-hero-top"><span class="pill-status">In review</span></div>
      <a id="review-side-link" href="#proposal-review">Review</a>
      <div id="review-panel"></div>`;
    syncListingBallotChrome(document.body, {
      id: "d1",
      proposal_id: "p1",
      kind: "claim_extension",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-10-07T00:00:00Z",
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
    });
    const jump = document.querySelector("#review-side-link") as HTMLElement;
    const pill = document.querySelector(".pill-status") as HTMLElement;
    expect(jump.dataset.ballotChrome).toBe("1");
    expect(pill.dataset.ballotChrome).toBe("1");
    // Callers that honor the mark leave the ballot primary in place.
    if (jump.dataset.ballotChrome === "1" || pill.dataset.ballotChrome === "1") {
      // skip statusPillHtml overwrite
    } else {
      pill.outerHTML = statusPillHtml("in_review");
    }
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Time extension — open",
    );
  });

  it("reapply after pill clobber keeps Completion review primary (deliverable_confirm)", () => {
    document.body.innerHTML = `
      <div class="proposal-hero-top"><span class="pill-status">In review</span></div>
      <div class="proposal-funding-bar"><span class="funding-meter-label">In review</span></div>
      <a id="review-side-link" href="#proposal-review">In review</a>
      <p id="next-card-sentence">Reviewers are checking the work.</p>
      <div id="review-panel"></div>`;
    const decision = {
      id: "d-deliv-1",
      proposal_id: "PLEBLY-2026-003",
      kind: "deliverable_confirm",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-10-05T00:00:00Z",
      status: "open",
      counts: { yes: 0, no: 0, abstain: 0 },
      vote_count: 0,
      escalated: true,
    };
    // sync stashes reviewDecisionId with chrome (no separate post-assign needed).
    syncListingBallotChrome(document.body, decision);
    const panel = document.querySelector("#review-panel") as HTMLElement;
    expect(panel.dataset.reviewDecisionId).toBe(decision.id);
    expect(panel.dataset.ballotPrimaryLabel).toBe("Completion review — open");
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Completion review — open",
    );

    // Simulate builder-panel refreshStepper lifecycle overwrite of hero pill.
    const pillHost = document.querySelector(".proposal-hero-top")!;
    const prev = pillHost.querySelector(".pill-status");
    const next = statusPillHtml("in_review");
    if (prev && next) prev.outerHTML = next;
    expect(document.querySelector(".pill-status")?.textContent).toBe("In review");

    reapplyListingBallotChrome(document.body);
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Completion review — open",
    );
    expect(document.querySelector(".funding-meter-label")?.textContent).toBe(
      "Completion review — open",
    );
    expect(document.querySelector("#review-side-link")?.textContent).toBe(
      "Completion review — open",
    );
    expect(document.querySelector("#next-card-sentence")?.textContent).toBe(
      "Completion review — open",
    );
    expect(document.querySelector(".pill-status")?.textContent).not.toBe(
      "In review",
    );
  });

  it("closed reject + claim still in_review+flagged does not paint Closed — reject", () => {
    document.body.innerHTML = `
      <div class="proposal-hero-top"><span class="pill-status">In review</span></div>
      <div class="proposal-funding-bar"><span class="funding-meter-label">In review</span></div>
      <a id="review-side-link" href="#proposal-review">In review</a>
      <p id="next-card-sentence">Reviewers are checking the work.</p>
      <div class="next-card-primary"><button type="button" class="btn" id="builder-flag">Flag this close</button></div>
      <div id="review-panel"></div>`;
    const closedReject = {
      id: "d-closed-reject",
      proposal_id: "PLEBLY-2026-001",
      kind: "deliverable_confirm",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-01-02T00:00:00Z",
      status: "closed",
      counts: { yes: 0, no: 3, abstain: 0 },
      vote_count: 3,
      passed: false,
      result: "reject",
      ai_decisive: true,
    };
    const claimCtx = {
      state: "in_review",
      status: "in_review",
      donorReviewStatus: "flagged",
      listingStatus: "in_review",
    };
    expect(claimAllowsClosedBallotListingChrome(claimCtx)).toBe(false);
    expect(listingBallotStatusLabel(closedReject, claimCtx)).toBe(
      flaggedDisputedListingLabel(),
    );
    expect(listingBallotStatusLabel(closedReject, claimCtx)).not.toContain(
      "Closed",
    );
    // Panel-native primary may still say Closed — reject (honest about ballot).
    expect(primaryBallotStatusLabel(closedReject)).toBe("Closed — reject");

    syncListingBallotChrome(document.body, closedReject, claimCtx);
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Flagged — disputed",
    );
    expect(document.querySelector(".funding-meter-label")?.textContent).toBe(
      "Flagged — disputed",
    );
    expect(document.querySelector("#review-side-link")?.textContent).toBe(
      "Flagged — disputed",
    );
    expect(document.querySelector("#next-card-sentence")?.textContent).toBe(
      "Flagged — disputed",
    );
    expect(document.querySelector("#builder-flag")).toBeNull();
    expect(document.querySelector(".pill-status")?.textContent).not.toBe(
      "Closed — reject",
    );

    // Late stepper clobber → reapply keeps flagged vocabulary, not Closed.
    const pillHost = document.querySelector(".proposal-hero-top")!;
    const prev = pillHost.querySelector(".pill-status");
    const next = statusPillHtml("in_review");
    if (prev && next) prev.outerHTML = next;
    reapplyListingBallotChrome(document.body);
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Flagged — disputed",
    );
    expect(document.querySelector(".pill-status")?.textContent).not.toMatch(
      /^Closed/,
    );
  });

  it("closed reject paints Closed when claim/listing is actually rejected", () => {
    document.body.innerHTML = `
      <div class="proposal-hero-top"><span class="pill-status">Rejected</span></div>
      <div class="proposal-funding-bar"><span class="funding-meter-label">Rejected</span></div>
      <a id="review-side-link" href="#proposal-review">Rebuttal</a>
      <p id="next-card-sentence">The builder has time to reply once.</p>
      <div id="review-panel"></div>`;
    const closedReject = {
      id: "d-closed-reject-2",
      proposal_id: "p-rej",
      kind: "deliverable_confirm",
      round: 1,
      created_at: "2026-01-01T00:00:00Z",
      closes_at: "2026-01-02T00:00:00Z",
      status: "closed",
      counts: { yes: 0, no: 3, abstain: 0 },
      vote_count: 3,
      passed: false,
      result: "reject",
    };
    syncListingBallotChrome(document.body, closedReject, {
      state: "rejected",
      status: "rejected",
      listingStatus: "rejected",
    });
    expect(document.querySelector(".pill-status")?.textContent).toBe(
      "Closed — reject",
    );
  });
});
