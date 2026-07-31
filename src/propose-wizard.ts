import { formatSats, escapeHtml } from "./util";
import type { DependsOnEntry, RelatedWorkEntry } from "./types";
import type { MilestoneDraft } from "./propose-milestones";

export type ProposeWizardStepId =
  | "basics"
  | "scope"
  | "funding"
  | "context"
  | "review";

export type ProposeWizardStep = {
  id: ProposeWizardStepId;
  label: string;
  short: string;
  title: string;
  lede: string;
};

export const PROPOSE_WIZARD_STEPS: ProposeWizardStep[] = [
  {
    id: "basics",
    label: "Basics",
    short: "1",
    title: "Project basics",
    lede: "Name the work, choose bounty or direct, and set discovery fields.",
  },
  {
    id: "scope",
    label: "Scope",
    short: "2",
    title: "Scope & verification",
    lede: "Write what will ship and how an independent reviewer can say yes or no.",
  },
  {
    id: "funding",
    label: "Funding",
    short: "3",
    title: "Funding & milestones",
    lede: "Set an optional target and stage larger work into milestones.",
  },
  {
    id: "context",
    label: "Links",
    short: "4",
    title: "Dependencies & related work",
    lede: "Optional context. Skip if nothing blocks or informs this project.",
  },
  {
    id: "review",
    label: "Review",
    short: "5",
    title: "Review & submit",
    lede: "Confirm the draft, then pay the submission fee to open the pull request.",
  },
];

export function proposeWizardStepIndex(id: ProposeWizardStepId): number {
  return PROPOSE_WIZARD_STEPS.findIndex((s) => s.id === id);
}

export function proposeWizardProgressHtml(
  current: ProposeWizardStepId,
): string {
  const currentIdx = proposeWizardStepIndex(current);
  return `<ol class="propose-wizard-progress" aria-label="Proposal steps">
    ${PROPOSE_WIZARD_STEPS.map((step, i) => {
      const state =
        i < currentIdx ? "is-done" : i === currentIdx ? "is-current" : "";
      const aria =
        i === currentIdx
          ? ' aria-current="step"'
          : i < currentIdx
            ? ' data-complete="true"'
            : "";
      return `<li class="propose-wizard-progress-item ${state}" data-step="${step.id}"${aria}>
        <button type="button" class="propose-wizard-progress-btn" data-goto-step="${step.id}" ${i > currentIdx ? "disabled" : ""}>
          <span class="propose-wizard-progress-num">${i < currentIdx ? "✓" : step.short}</span>
          <span class="propose-wizard-progress-label">${escapeHtml(step.label)}</span>
        </button>
      </li>`;
    }).join("")}
  </ol>`;
}

export function proposeWizardNavHtml(opts: {
  current: ProposeWizardStepId;
  isEdit: boolean;
  isBridge: boolean;
}): string {
  const idx = proposeWizardStepIndex(opts.current);
  const isFirst = idx <= 0;
  const isLast = idx >= PROPOSE_WIZARD_STEPS.length - 1;
  const submitLabel = opts.isEdit
    ? "Open amend PR"
    : opts.isBridge
      ? "Pay fee & update draft PR"
      : "Open proposal";
  return `<div class="propose-wizard-nav" id="propose-wizard-nav">
    <button type="button" class="btn ghost" id="propose-wizard-back" ${isFirst ? "hidden" : ""}>Back</button>
    <div class="propose-wizard-nav-end">
      ${
        opts.current === "context"
          ? `<button type="button" class="btn ghost" id="propose-wizard-skip">Skip</button>`
          : ""
      }
      ${
        isLast
          ? `<button type="submit" class="btn" id="propose-wizard-submit">${escapeHtml(submitLabel)}</button>`
          : `<button type="button" class="btn" id="propose-wizard-next">Continue</button>`
      }
    </div>
  </div>`;
}

export type BasicsDraft = {
  title: string;
  proposal_type: "bounty" | "direct";
};

export type ScopeDraft = {
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
};

/** Named form control error (matches `name=` on the propose form). */
export type NamedFieldError = {
  field: string;
  message: string;
};

export type DraftValidationFail = {
  ok: false;
  errors: NamedFieldError[];
  /** First error message (compat / screen-reader summary). */
  error: string;
  /** First failing field name. */
  focus: string;
};

function failNamed(errors: NamedFieldError[]): DraftValidationFail {
  return {
    ok: false,
    errors,
    error: errors[0]?.message || "Fix the highlighted fields.",
    focus: errors[0]?.field || "",
  };
}

export function validateBasicsDraft(
  draft: BasicsDraft,
): { ok: true } | DraftValidationFail {
  const errors: NamedFieldError[] = [];
  const title = draft.title.trim();
  if (title.length < 3) {
    errors.push({
      field: "title",
      message: "Title needs at least 3 characters.",
    });
  } else if (title.length > 200) {
    errors.push({
      field: "title",
      message: "Title must be 200 characters or fewer.",
    });
  }
  if (draft.proposal_type !== "bounty" && draft.proposal_type !== "direct") {
    errors.push({
      field: "proposal_type",
      message: "Choose bounty or direct.",
    });
  }
  return errors.length ? failNamed(errors) : { ok: true };
}

export function validateScopeDraft(
  draft: ScopeDraft,
): { ok: true } | DraftValidationFail {
  const errors: NamedFieldError[] = [];
  if (draft.problem.trim().length < 40) {
    errors.push({
      field: "problem",
      message: "Needs at least 40 characters.",
    });
  }
  if (draft.deliverable.trim().length < 40) {
    errors.push({
      field: "deliverable",
      message: "Needs at least 40 characters.",
    });
  }
  if (draft.verification.trim().length < 40) {
    errors.push({
      field: "verification",
      message: "Needs at least 40 characters.",
    });
  }
  if (draft.out_of_scope.trim().length < 10) {
    errors.push({
      field: "out_of_scope",
      message: "Needs at least 10 characters.",
    });
  }
  return errors.length ? failNamed(errors) : { ok: true };
}

export function clearProposeFieldErrors(root: ParentNode): void {
  root.querySelectorAll(".field-error").forEach((el) => el.remove());
  root.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
  });
  root.querySelectorAll("[aria-invalid='true']").forEach((el) => {
    el.removeAttribute("aria-invalid");
  });
}

function fieldHostForControl(control: Element): HTMLElement | null {
  return (
    (control.closest(".field") as HTMLElement | null) ||
    (control.closest(".propose-type") as HTMLElement | null) ||
    (control.parentElement as HTMLElement | null)
  );
}

/** Attach / replace an inline error on the field wrapping `control`. */
export function setControlFieldError(
  control: Element | null | undefined,
  message: string,
): HTMLElement | null {
  if (!control) return null;
  const host = fieldHostForControl(control);
  if (!host) return null;
  host.classList.add("is-invalid");
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    control.setAttribute("aria-invalid", "true");
  }
  let err = host.querySelector<HTMLElement>(":scope > .field-error");
  if (!err) {
    err = document.createElement("p");
    err.className = "field-error";
    err.setAttribute("role", "alert");
    host.appendChild(err);
  }
  err.textContent = message;
  return control instanceof HTMLElement ? control : null;
}

export function setNamedFieldError(
  form: HTMLFormElement,
  name: string,
  message: string,
): HTMLElement | null {
  const el = form.elements.namedItem(name);
  if (!el) return null;
  const control =
    el instanceof RadioNodeList
      ? (el[0] as Element | undefined)
      : (el as Element);
  return setControlFieldError(control, message);
}

/** Apply named-field errors; returns the first control for focus/scroll. */
export function applyNamedFieldErrors(
  form: HTMLFormElement,
  errors: NamedFieldError[],
): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (const err of errors) {
    const control = setNamedFieldError(form, err.field, err.message);
    if (!first && control) first = control;
  }
  return first;
}

/** Clear only the inline error on the field containing `control`. */
export function clearControlFieldError(control: Element | null): void {
  if (!control) return;
  const host = fieldHostForControl(control);
  if (!host) return;
  host.classList.remove("is-invalid");
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLTextAreaElement ||
    control instanceof HTMLSelectElement
  ) {
    control.removeAttribute("aria-invalid");
  }
  host.querySelectorAll(":scope > .field-error").forEach((el) => el.remove());
}

export type ReviewSummaryInput = {
  title: string;
  proposal_type: "bounty" | "direct";
  tags: string[];
  parent_initiative: string | null;
  cover_image: string | null;
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  notes: string | null;
  target_sats: number | null;
  milestones: MilestoneDraft[];
  depends_on: DependsOnEntry[];
  related_work: RelatedWorkEntry[];
  isEdit: boolean;
  feeLabel: string;
};

function clip(text: string, max = 160): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function proposeReviewSummaryHtml(input: ReviewSummaryInput): string {
  const typeLabel = input.proposal_type === "direct" ? "Direct" : "Bounty";
  const tags =
    input.tags.length > 0
      ? input.tags.map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join(" ")
      : `<span class="muted">None</span>`;
  const ms =
    input.milestones.length > 0
      ? `${input.milestones.length} stage${input.milestones.length === 1 ? "" : "s"} · ${escapeHtml(formatSats(input.milestones.reduce((s, m) => s + (m.allocation_sats || 0), 0)))} allocated`
      : "None";
  const deps =
    input.depends_on.length > 0
      ? `${input.depends_on.length} blocking`
      : "None";
  const related =
    input.related_work.length > 0
      ? `${input.related_work.length} link${input.related_work.length === 1 ? "" : "s"}`
      : "None";

  return `<div class="propose-review" id="propose-review">
    <div class="propose-review-card">
      <div class="propose-review-head">
        <h3 class="propose-review-title">${escapeHtml(input.title || "Untitled")}</h3>
        <span class="pill">${escapeHtml(typeLabel)}</span>
      </div>
      <dl class="propose-review-grid">
        <div>
          <dt>Tags</dt>
          <dd class="propose-review-tags">${tags}</dd>
        </div>
        <div>
          <dt>Parent initiative</dt>
          <dd>${escapeHtml(input.parent_initiative || "—")}</dd>
        </div>
        <div>
          <dt>Cover</dt>
          <dd>${input.cover_image ? "Attached" : "None"}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>${input.target_sats != null ? escapeHtml(formatSats(input.target_sats)) : "Open / unspecified"}</dd>
        </div>
        <div>
          <dt>Milestones</dt>
          <dd>${ms}</dd>
        </div>
        <div>
          <dt>Depends on</dt>
          <dd>${deps}</dd>
        </div>
        <div>
          <dt>Related work</dt>
          <dd>${related}</dd>
        </div>
      </dl>
      <div class="propose-review-sections">
        <section>
          <h4>Problem</h4>
          <p>${escapeHtml(clip(input.problem))}</p>
        </section>
        <section>
          <h4>Deliverable</h4>
          <p>${escapeHtml(clip(input.deliverable))}</p>
        </section>
        <section>
          <h4>Verification</h4>
          <p>${escapeHtml(clip(input.verification))}</p>
        </section>
        <section>
          <h4>Out of scope</h4>
          <p>${escapeHtml(clip(input.out_of_scope))}</p>
        </section>
        ${
          input.notes
            ? `<section>
          <h4>Notes</h4>
          <p>${escapeHtml(clip(input.notes))}</p>
        </section>`
            : ""
        }
      </div>
    </div>
    ${
      input.isEdit
        ? `<p class="field-hint">No submission fee for amends. Opening an amend PR keeps lifecycle fields intact until merge.</p>`
        : `<p class="field-hint">Submission fee: <strong>${escapeHtml(input.feeLabel)}</strong>, exact amount on-chain. Unpaid invoices do not open a PR.</p>`
    }
  </div>`;
}

export function readNamedValue(
  form: HTMLFormElement,
  name: string,
): string {
  const el = form.elements.namedItem(name);
  if (!el) return "";
  if (el instanceof RadioNodeList) {
    return String(el.value || "");
  }
  return String((el as HTMLInputElement | HTMLTextAreaElement).value || "");
}

export function focusFormField(form: HTMLFormElement, name: string): void {
  const el = form.elements.namedItem(name);
  const target =
    el instanceof RadioNodeList
      ? (el[0] as HTMLElement | undefined)
      : (el as HTMLElement | null);
  target?.focus?.();
  target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
}
