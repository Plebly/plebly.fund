import { describe, expect, it } from "vitest";
import {
  applyNamedFieldErrors,
  clearProposeFieldErrors,
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
    const bad = validateBasicsDraft({ title: "ab", proposal_type: "bounty" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.focus).toBe("title");
      expect(bad.error).toBe("Title needs at least 3 characters.");
      expect(bad.errors).toEqual([
        { field: "title", message: "Title needs at least 3 characters." },
      ]);
    }
    expect(
      validateBasicsDraft({ title: "Ship docs", proposal_type: "direct" }),
    ).toEqual({ ok: true });
  });

  it("enforces scope minimum lengths and collects every failing field", () => {
    const short = validateScopeDraft({
      problem: "too short",
      deliverable: "x".repeat(40),
      verification: "x".repeat(40),
      out_of_scope: "long enough",
    });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.focus).toBe("problem");
      expect(short.errors.map((e) => e.field)).toEqual(["problem"]);
    }

    const many = validateScopeDraft({
      problem: "short",
      deliverable: "short",
      verification: "short",
      out_of_scope: "x",
    });
    expect(many.ok).toBe(false);
    if (!many.ok) {
      expect(many.errors.map((e) => e.field)).toEqual([
        "problem",
        "deliverable",
        "verification",
        "out_of_scope",
      ]);
    }

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

describe("propose field errors", () => {
  it("attaches an alert next to the failing control", () => {
    document.body.innerHTML = `
      <form id="f">
        <label class="field">
          <span>Title</span>
          <input name="title" />
        </label>
      </form>
    `;
    const form = document.getElementById("f") as HTMLFormElement;
    applyNamedFieldErrors(form, [
      { field: "title", message: "Title needs at least 3 characters." },
    ]);
    const input = form.elements.namedItem("title") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.closest(".field")?.classList.contains("is-invalid")).toBe(true);
    expect(form.querySelector(".field-error")?.textContent).toBe(
      "Title needs at least 3 characters.",
    );
    clearProposeFieldErrors(form);
    expect(form.querySelector(".field-error")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
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
