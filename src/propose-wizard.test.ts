import { describe, expect, it } from "vitest";
import {
  proposeReviewSummaryHtml,
  proposeWizardNavHtml,
  proposeWizardProgressHtml,
  proposeWizardStepIndex,
  PROPOSE_WIZARD_STEPS,
  validateBasicsDraft,
  validateScopeDraft,
} from "./propose-wizard";

describe("propose wizard steps", () => {
  it("orders five guided steps", () => {
    expect(PROPOSE_WIZARD_STEPS.map((s) => s.id)).toEqual([
      "basics",
      "scope",
      "funding",
      "context",
      "review",
    ]);
    expect(proposeWizardStepIndex("funding")).toBe(2);
  });

  it("marks current and completed progress states", () => {
    const html = proposeWizardProgressHtml("funding");
    expect(html).toContain('data-step="basics"');
    expect(html).toContain("is-done");
    expect(html).toContain('data-step="funding"');
    expect(html).toContain("is-current");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('data-goto-step="review"');
  });

  it("renders continue on early steps and submit on review", () => {
    const mid = proposeWizardNavHtml({
      current: "scope",
      isEdit: false,
      isBridge: false,
    });
    expect(mid).toContain("propose-wizard-next");
    expect(mid).toContain("Continue");
    expect(mid).not.toContain("propose-wizard-submit");

    const review = proposeWizardNavHtml({
      current: "review",
      isEdit: false,
      isBridge: false,
    });
    expect(review).toContain("Open proposal PR");
    expect(review).not.toContain("propose-wizard-next");

    const context = proposeWizardNavHtml({
      current: "context",
      isEdit: true,
      isBridge: false,
    });
    expect(context).toContain("propose-wizard-skip");
    expect(context).toContain("Continue");
  });
});

describe("propose wizard validation", () => {
  it("requires a real title and type on basics", () => {
    expect(validateBasicsDraft({ title: "ab", proposal_type: "bounty" })).toEqual(
      {
        ok: false,
        error: "Title needs at least 3 characters.",
        focus: "title",
      },
    );
    expect(
      validateBasicsDraft({ title: "Ship docs", proposal_type: "direct" }),
    ).toEqual({ ok: true });
  });

  it("enforces scope minimum lengths", () => {
    const short = validateScopeDraft({
      problem: "too short",
      deliverable: "x".repeat(40),
      verification: "x".repeat(40),
      out_of_scope: "not this",
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.focus).toBe("problem");

    expect(
      validateScopeDraft({
        problem: "x".repeat(40),
        deliverable: "x".repeat(40),
        verification: "x".repeat(40),
        out_of_scope: "not included",
      }),
    ).toEqual({ ok: true });
  });
});

describe("propose review summary", () => {
  it("renders clipped draft fields and fee hint", () => {
    const html = proposeReviewSummaryHtml({
      title: "Improve mempool docs",
      proposal_type: "bounty",
      tags: ["docs", "core"],
      parent_initiative: "Bitcoin Core Commons",
      cover_image: "https://example.com/c.jpg",
      problem: "Operators lack a clear guide. ".repeat(8),
      deliverable: "Publish a guide with examples and an OSI license.",
      verification: "1. Open the URL. 2. Follow setup from clean env.",
      out_of_scope: "Hosted ops and translations.",
      notes: "See related work.",
      target_sats: 2_000_000,
      milestones: [
        {
          deliverable: "Draft",
          verification: "PR open",
          out_of_scope: "n/a",
          allocation_sats: 1_000_000,
          deadline: "2026-12-01",
        },
      ],
      depends_on: [],
      related_work: [{ label: "Prior art", url: "https://example.com" }],
      isEdit: false,
      feeLabel: "10,000 sats",
    });
    expect(html).toContain("Improve mempool docs");
    expect(html).toContain("Bounty");
    expect(html).toContain("docs");
    expect(html).toContain("1 stage");
    expect(html).toContain("1 link");
    expect(html).toContain("Submission fee");
    expect(html).toContain("10,000 sats");
    expect(html).toContain("…");
  });
});
