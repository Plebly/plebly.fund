import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewDecisionView } from "./reviewers";

const decision: ReviewDecisionView = {
  id: "dec-chal",
  proposal_id: "p-chal",
  kind: "deliverable_confirm",
  round: 1,
  created_at: new Date().toISOString(),
  closes_at: new Date(Date.now() + 86400_000).toISOString(),
  status: "open",
  counts: { yes: 0, no: 0, abstain: 0 },
  vote_count: 0,
  ai_review: {
    outcome: "fail",
    prompt_version: "v1",
    model: "m",
    reasoning: "Missing proof",
  },
};

const challengeAiReviewDecision = vi.fn();

vi.mock("./reviewers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./reviewers")>();
  return {
    ...mod,
    fetchOpenReviewDecision: vi.fn(async () => decision),
    fetchReviewerMe: vi.fn(async () => null),
    challengeAiReviewDecision: (...args: unknown[]) =>
      challengeAiReviewDecision(...args),
  };
});

describe("bindReviewPanel Challenge AI click", () => {
  beforeEach(async () => {
    challengeAiReviewDecision.mockReset();
    challengeAiReviewDecision.mockResolvedValue({
      ...decision,
      escalated: true,
      ai_challenged_at: new Date().toISOString(),
    });
    const { reviewPanelHtml } = await import("./review-panel");
    document.body.innerHTML = reviewPanelHtml("p-chal");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows Challenge AI and posts challenge-ai on click", async () => {
    const { bindReviewPanel } = await import("./review-panel");
    await bindReviewPanel(document.body, {
      proposalId: "p-chal",
      user: { id: "github:donor", username: "donor" },
    });

    const slot = document.querySelector<HTMLElement>("#review-challenge-ai");
    expect(slot?.hidden).toBe(false);

    const reason = document.querySelector<HTMLTextAreaElement>(
      "#challenge-ai-reason",
    )!;
    reason.value = "Disagree with AI cites.";
    document.querySelector<HTMLButtonElement>("#challenge-ai-submit")!.click();

    await vi.waitFor(() => {
      expect(challengeAiReviewDecision).toHaveBeenCalledWith(
        "dec-chal",
        "Disagree with AI cites.",
      );
    });

    await vi.waitFor(() => {
      expect(
        document.querySelector<HTMLElement>("#review-challenge-ai")?.hidden,
      ).toBe(true);
      expect(document.querySelector("#review-status")?.textContent).toContain(
        "Escalated to humans",
      );
      expect(document.querySelector("#review-msg")?.textContent).toMatch(
        /escalated to humans/i,
      );
    });
  });
});
