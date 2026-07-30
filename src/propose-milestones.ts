import { MILESTONE_THRESHOLD_SATS } from "./config";
import type { ProposalMilestone } from "./types";
import { escapeHtml, formatSats } from "./util";

export const MAX_MILESTONES = 12;

export type MilestoneDraft = {
  id?: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  allocation_sats: number;
  deadline: string;
  dependencies?: string[];
};

export function milestoneEditorSectionHtml(): string {
  return `<fieldset class="form-block" id="milestones-block">
    <legend>Milestones <em class="optional">(optional unless target ≥ ${escapeHtml(formatSats(MILESTONE_THRESHOLD_SATS))})</em></legend>
    <p class="field-hint">
      Stage the work with sats and due dates. Leave empty for small bounties.
      Use <strong>Remove</strong> on any stage you do not want, including ones you just added.
    </p>
    <div id="milestones-empty" class="editor-empty">No milestones yet. Add stages if you want phased delivery.</div>
    <div id="milestones-list" class="milestone-editor-list"></div>
    <div class="milestone-editor-foot">
      <button type="button" class="btn ghost" id="add-milestone-btn">Add milestone</button>
      <span class="muted" id="milestones-total"></span>
    </div>
    <p class="field-hint" id="milestones-funding-hint" hidden></p>
  </fieldset>`;
}

export function priorDepsHtml(
  index: number,
  selected: string[] | undefined,
): string {
  if (index === 0) {
    return `<div class="ms-dep-slot" data-ms-dep-slot><p class="field-hint">First stage. Nothing to depend on yet.</p></div>`;
  }
  const boxes = Array.from({ length: index }, (_, i) => {
    const id = `m${i + 1}`;
    const checked = selected?.includes(id) ? "checked" : "";
    return `<label class="ms-dep-check"><input type="checkbox" class="ms-dep" value="${id}" ${checked} /> ${id}</label>`;
  }).join("");
  return `<div class="ms-dep-slot field" data-ms-dep-slot>
    <span>Depends on prior stages</span>
    <div class="ms-dep-list">${boxes}</div>
  </div>`;
}

/** Soft copy when allocations and target diverge (not a hard error). */
export function milestonesFundingHint(
  targetSats: number | null,
  allocated: number,
  stageCount: number,
): string {
  if (targetSats != null && targetSats >= MILESTONE_THRESHOLD_SATS && stageCount === 0) {
    return `Target is ≥ ${formatSats(MILESTONE_THRESHOLD_SATS)}. Add at least one milestone before submitting.`;
  }
  if (targetSats != null && targetSats > 0 && allocated > 0 && allocated !== targetSats) {
    const delta = allocated - targetSats;
    const dir = delta > 0 ? "over" : "under";
    return `Allocated ${formatSats(allocated)} vs target ${formatSats(targetSats)} (${dir} by ${formatSats(Math.abs(delta))}). Display-only, not blocked.`;
  }
  return "";
}

/**
 * Remap `mN` dependency ids after deleting the milestone at `deletedIndex` (0-based).
 * Drops deps that pointed at the deleted stage; shifts later ids down.
 */
export function remapDepIdsAfterDelete(
  deps: string[],
  deletedIndex: number,
): string[] {
  const out: string[] = [];
  for (const id of deps) {
    const m = /^m(\d+)$/.exec(id);
    if (!m) continue;
    const oldIndex0 = Number(m[1]) - 1;
    if (oldIndex0 === deletedIndex) continue;
    if (oldIndex0 > deletedIndex) out.push(`m${oldIndex0}`);
    else out.push(`m${oldIndex0 + 1}`);
  }
  return out;
}

export function milestoneRowHtml(
  index: number,
  draft?: Partial<MilestoneDraft>,
): string {
  const d = draft || {};
  return `<div class="milestone-editor-row" data-index="${index}">
    <div class="milestone-editor-row-head">
      <span class="milestone-editor-n">Milestone ${index + 1}</span>
      <button type="button" class="editor-remove remove-milestone" aria-label="Remove milestone ${index + 1}">Remove</button>
    </div>
    <label class="field">
      <span>Deliverable</span>
      <textarea class="ms-deliverable" rows="2" maxlength="2000" placeholder="What ships in this stage">${escapeHtml(d.deliverable || "")}</textarea>
    </label>
    <label class="field">
      <span>Verification</span>
      <textarea class="ms-verification" rows="2" maxlength="2000" placeholder="How a reviewer confirms this stage">${escapeHtml(d.verification || "")}</textarea>
    </label>
    <label class="field">
      <span>Out of scope</span>
      <textarea class="ms-oos" rows="2" maxlength="2000" placeholder="What this stage does not include">${escapeHtml(d.out_of_scope || "")}</textarea>
    </label>
    <div class="field-row milestone-editor-meta">
      <label class="field">
        <span>Allocation (sats)</span>
        <input class="ms-sats" type="number" min="0" step="1" placeholder="50000" value="${d.allocation_sats ? escapeHtml(String(d.allocation_sats)) : ""}" />
      </label>
      <label class="field">
        <span>Deadline</span>
        <input class="ms-deadline" type="date" value="${escapeHtml(d.deadline || "")}" />
      </label>
    </div>
    ${priorDepsHtml(index, d.dependencies)}
  </div>`;
}

/** Rebuild prior-milestone checkboxes. Optional per-row selected overrides (same order as rows). */
export function refreshMilestoneDepSlots(
  list: ParentNode,
  selectedByRow?: string[][],
): void {
  const rows = [...list.querySelectorAll<HTMLElement>(".milestone-editor-row")];
  rows.forEach((row, index) => {
    const selected =
      selectedByRow?.[index] ??
      [...row.querySelectorAll<HTMLInputElement>(".ms-dep:checked")].map(
        (el) => el.value,
      );
    const slot = row.querySelector("[data-ms-dep-slot]");
    const html = priorDepsHtml(index, selected);
    if (slot) slot.outerHTML = html;
    else row.insertAdjacentHTML("beforeend", html);
  });
}

/**
 * Remove a milestone row, renumber survivors, and remap intra-stage dependency checkboxes.
 * Returns false if `row` is not a milestone editor row in `list`.
 */
export function removeMilestoneRow(list: ParentNode, row: HTMLElement): boolean {
  const rows = [...list.querySelectorAll<HTMLElement>(".milestone-editor-row")];
  const deletedIndex = rows.indexOf(row);
  if (deletedIndex < 0) return false;

  const depsBefore = rows.map((r) =>
    [...r.querySelectorAll<HTMLInputElement>(".ms-dep:checked")].map(
      (el) => el.value,
    ),
  );
  row.remove();

  const remaining = [
    ...list.querySelectorAll<HTMLElement>(".milestone-editor-row"),
  ];
  const selectedByRow = depsBefore
    .filter((_, i) => i !== deletedIndex)
    .map((deps) => remapDepIdsAfterDelete(deps, deletedIndex));

  remaining.forEach((r, i) => {
    r.dataset.index = String(i);
    const label = r.querySelector(".milestone-editor-n");
    if (label) label.textContent = `Milestone ${i + 1}`;
    const removeBtn = r.querySelector(".remove-milestone");
    if (removeBtn) {
      removeBtn.setAttribute("aria-label", `Remove milestone ${i + 1}`);
    }
  });
  refreshMilestoneDepSlots(list, selectedByRow);
  return true;
}

/** Read milestone drafts from the editor DOM. Skips fully empty rows. */
export function collectMilestoneDrafts(root: ParentNode): MilestoneDraft[] {
  const rows = root.querySelectorAll<HTMLElement>(".milestone-editor-row");
  const out: MilestoneDraft[] = [];
  rows.forEach((row) => {
    const deliverable = (
      row.querySelector(".ms-deliverable") as HTMLTextAreaElement
    )?.value.trim();
    const verification = (
      row.querySelector(".ms-verification") as HTMLTextAreaElement
    )?.value.trim();
    const out_of_scope = (
      row.querySelector(".ms-oos") as HTMLTextAreaElement
    )?.value.trim();
    const satsRaw = (row.querySelector(".ms-sats") as HTMLInputElement)?.value;
    const deadline = (
      row.querySelector(".ms-deadline") as HTMLInputElement
    )?.value.trim();
    const deps = [
      ...row.querySelectorAll<HTMLInputElement>(".ms-dep:checked"),
    ].map((el) => el.value);
    const empty =
      !deliverable && !verification && !out_of_scope && !satsRaw && !deadline;
    if (empty) return;
    out.push({
      deliverable: deliverable || "",
      verification: verification || "",
      out_of_scope: out_of_scope || "",
      allocation_sats: satsRaw ? Number(satsRaw) : 0,
      deadline: deadline || "",
      ...(deps.length ? { dependencies: deps } : {}),
    });
  });
  return out;
}

export type MilestoneFieldKey =
  | "deliverable"
  | "verification"
  | "out_of_scope"
  | "allocation_sats"
  | "deadline";

export type MilestoneValidationFail = {
  ok: false;
  error: string;
  focus?:
    | { type: "block"; message: string }
    | { type: "row"; index: number; field: MilestoneFieldKey; message: string };
};

const MS_FIELD_SELECTOR: Record<MilestoneFieldKey, string> = {
  deliverable: ".ms-deliverable",
  verification: ".ms-verification",
  out_of_scope: ".ms-oos",
  allocation_sats: ".ms-sats",
  deadline: ".ms-deadline",
};

export function milestoneFieldSelector(field: MilestoneFieldKey): string {
  return MS_FIELD_SELECTOR[field];
}

export function validateMilestoneDrafts(
  drafts: MilestoneDraft[],
  targetSats: number | null,
):
  | { ok: true; milestones: ProposalMilestone[] }
  | MilestoneValidationFail {
  const need =
    targetSats != null && targetSats >= MILESTONE_THRESHOLD_SATS;
  if (need && drafts.length === 0) {
    const message = `Add at least one milestone when target funding is ≥ ${formatSats(MILESTONE_THRESHOLD_SATS)}.`;
    return {
      ok: false,
      error: message,
      focus: { type: "block", message },
    };
  }
  if (drafts.length === 0) {
    return { ok: true, milestones: [] };
  }

  const milestones: ProposalMilestone[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const n = i + 1;
    if (d.deliverable.length < 10) {
      const message = "Deliverable needs at least 10 characters.";
      return {
        ok: false,
        error: `Milestone ${n}: deliverable needs at least 10 characters.`,
        focus: { type: "row", index: i, field: "deliverable", message },
      };
    }
    if (d.verification.length < 10) {
      const message = "Verification needs at least 10 characters.";
      return {
        ok: false,
        error: `Milestone ${n}: verification needs at least 10 characters.`,
        focus: { type: "row", index: i, field: "verification", message },
      };
    }
    if (!d.out_of_scope) {
      const message = "Out of scope is required.";
      return {
        ok: false,
        error: `Milestone ${n}: out of scope is required.`,
        focus: { type: "row", index: i, field: "out_of_scope", message },
      };
    }
    if (!Number.isFinite(d.allocation_sats) || d.allocation_sats < 1) {
      const message = "Allocation must be at least 1 sat.";
      return {
        ok: false,
        error: `Milestone ${n}: allocation must be at least 1 sat.`,
        focus: { type: "row", index: i, field: "allocation_sats", message },
      };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.deadline)) {
      const message = "Pick a deadline date.";
      return {
        ok: false,
        error: `Milestone ${n}: pick a deadline date.`,
        focus: { type: "row", index: i, field: "deadline", message },
      };
    }
    const id = `m${n}`;
    const deps = (d.dependencies || []).filter((dep) => {
      const m = /^m(\d+)$/.exec(dep);
      if (!m) return false;
      const idx = Number(m[1]);
      return idx >= 1 && idx < n;
    });
    milestones.push({
      id,
      deliverable: d.deliverable,
      verification: d.verification,
      out_of_scope: d.out_of_scope,
      allocation_sats: Math.floor(d.allocation_sats),
      deadline: d.deadline,
      ...(deps.length ? { dependencies: deps } : {}),
    });
  }
  return { ok: true, milestones };
}

export function milestonesAllocatedTotal(drafts: MilestoneDraft[]): number {
  return drafts.reduce(
    (s, d) => s + (Number.isFinite(d.allocation_sats) ? d.allocation_sats : 0),
    0,
  );
}
