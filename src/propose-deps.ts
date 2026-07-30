import type { DependsOnEntry, RelatedWorkEntry } from "./types";
import { escapeHtml } from "./util";

export const MAX_DEPENDS_ON = 20;
export const MAX_RELATED_WORK = 20;

export function dependsOnSectionHtml(): string {
  return `<fieldset class="form-block" id="depends-on-block">
    <legend>Depends on <em class="optional">(optional)</em></legend>
    <p class="field-hint">Blocking work this project cannot finish without: another Plebly proposal or an external initiative. Remove any row you do not want.</p>
    <div id="depends-on-empty" class="editor-empty">No blocking dependencies.</div>
    <div id="depends-on-list" class="dep-editor-list"></div>
    <button type="button" class="btn ghost" id="add-depends-on-btn">Add dependency</button>
  </fieldset>`;
}

export function relatedWorkSectionHtml(): string {
  return `<fieldset class="form-block" id="related-work-block">
    <legend>Related work <em class="optional">(optional)</em></legend>
    <p class="field-hint">Non-blocking prior art and external links for context. Remove any row you do not want.</p>
    <div id="related-work-empty" class="editor-empty">No related links yet.</div>
    <div id="related-work-list" class="dep-editor-list"></div>
    <button type="button" class="btn ghost" id="add-related-work-btn">Add link</button>
  </fieldset>`;
}

export function depKindLabel(kind: string): string {
  return kind === "external" ? "External" : "Plebly";
}

export function depRefPlaceholder(kind: "plebly" | "external"): string {
  return kind === "external"
    ? "https://…"
    : "proposal-id or listed/slug";
}

export function depRefLabel(kind: "plebly" | "external"): string {
  return kind === "external" ? "URL" : "Proposal id or path";
}

export function dependsOnRowHtml(
  index: number,
  draft?: Partial<DependsOnEntry>,
): string {
  const d = draft || {};
  const kind = d.kind === "external" ? "external" : "plebly";
  return `<div class="dep-editor-row" data-kind="depends" data-index="${index}">
    <div class="milestone-editor-row-head">
      <span class="milestone-editor-n">Dependency ${index + 1}</span>
      <button type="button" class="editor-remove remove-dep" aria-label="Remove dependency">Remove</button>
    </div>
    <div class="field-row milestone-editor-meta">
      <label class="field">
        <span>Kind</span>
        <select class="dep-kind">
          <option value="plebly" ${kind === "plebly" ? "selected" : ""}>Plebly proposal</option>
          <option value="external" ${kind === "external" ? "selected" : ""}>External</option>
        </select>
      </label>
      <label class="field">
        <span>Label</span>
        <input class="dep-label" type="text" maxlength="200" placeholder="Short name" value="${escapeHtml(d.label || "")}" />
      </label>
    </div>
    <label class="field">
      <span class="dep-ref-label">${escapeHtml(depRefLabel(kind))}</span>
      <input class="dep-ref mono" type="text" maxlength="500" placeholder="${escapeHtml(depRefPlaceholder(kind))}" value="${escapeHtml(d.ref || "")}" />
    </label>
    <label class="field">
      <span>Note</span>
      <textarea class="dep-note" rows="2" maxlength="2000" placeholder="Why this blocks progress…">${escapeHtml(d.note || "")}</textarea>
    </label>
  </div>`;
}

export function relatedWorkRowHtml(
  index: number,
  draft?: Partial<RelatedWorkEntry>,
): string {
  const d = draft || {};
  return `<div class="dep-editor-row" data-kind="related" data-index="${index}">
    <div class="milestone-editor-row-head">
      <span class="milestone-editor-n">Related ${index + 1}</span>
      <button type="button" class="editor-remove remove-dep" aria-label="Remove related work">Remove</button>
    </div>
    <label class="field">
      <span>Label</span>
      <input class="rel-label" type="text" maxlength="200" placeholder="Short name" value="${escapeHtml(d.label || "")}" />
    </label>
    <label class="field">
      <span>URL</span>
      <input class="rel-url mono" type="text" inputmode="url" maxlength="500" placeholder="https://…" value="${escapeHtml(d.url || "")}" />
    </label>
    <label class="field">
      <span>Note</span>
      <textarea class="rel-note" rows="2" maxlength="2000" placeholder="Why this matters…">${escapeHtml(d.note || "")}</textarea>
    </label>
  </div>`;
}

export function syncDependsOnKindUi(row: HTMLElement): void {
  const kind = (
    (row.querySelector(".dep-kind") as HTMLSelectElement)?.value || "plebly"
  ) as "plebly" | "external";
  const label = row.querySelector(".dep-ref-label");
  const input = row.querySelector<HTMLInputElement>(".dep-ref");
  if (label) label.textContent = depRefLabel(kind);
  if (input) input.placeholder = depRefPlaceholder(kind);
}

export function collectDependsOn(root: ParentNode): DependsOnEntry[] {
  const out: DependsOnEntry[] = [];
  root.querySelectorAll<HTMLElement>('[data-kind="depends"]').forEach((row) => {
    const kind = (
      (row.querySelector(".dep-kind") as HTMLSelectElement)?.value || "plebly"
    ) as "plebly" | "external";
    const label = (
      row.querySelector(".dep-label") as HTMLInputElement
    )?.value.trim();
    const ref = (
      row.querySelector(".dep-ref") as HTMLInputElement
    )?.value.trim();
    const note = (
      row.querySelector(".dep-note") as HTMLTextAreaElement
    )?.value.trim();
    if (!label && !ref && !note) return;
    out.push({
      kind,
      label: label || "",
      ...(ref ? { ref } : {}),
      ...(note ? { note } : {}),
    });
  });
  return out;
}

export function collectRelatedWork(root: ParentNode): RelatedWorkEntry[] {
  const out: RelatedWorkEntry[] = [];
  root.querySelectorAll<HTMLElement>('[data-kind="related"]').forEach((row) => {
    const label = (
      row.querySelector(".rel-label") as HTMLInputElement
    )?.value.trim();
    const url = (
      row.querySelector(".rel-url") as HTMLInputElement
    )?.value.trim();
    const note = (
      row.querySelector(".rel-note") as HTMLTextAreaElement
    )?.value.trim();
    if (!label && !url && !note) return;
    out.push({
      label: label || "",
      url: url || "",
      ...(note ? { note } : {}),
    });
  });
  return out;
}

export type DepRowField = "label" | "ref" | "url";

export type DepValidationFail = {
  ok: false;
  error: string;
  focus: { index: number; field: DepRowField; message: string };
};

export function validateDependsOnDrafts(
  drafts: DependsOnEntry[],
):
  | { ok: true; value: DependsOnEntry[] }
  | DepValidationFail {
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const n = i + 1;
    if (!d.label) {
      return {
        ok: false,
        error: `Dependency ${n}: label required`,
        focus: { index: i, field: "label", message: "Label required." },
      };
    }
    if (d.kind === "external" && d.ref && !d.ref.startsWith("https://")) {
      return {
        ok: false,
        error: `Dependency ${n}: external ref must be https://`,
        focus: {
          index: i,
          field: "ref",
          message: "External ref must start with https://.",
        },
      };
    }
  }
  return { ok: true, value: drafts };
}

export function validateRelatedWorkDrafts(
  drafts: RelatedWorkEntry[],
):
  | { ok: true; value: RelatedWorkEntry[] }
  | DepValidationFail {
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const n = i + 1;
    if (!d.label) {
      return {
        ok: false,
        error: `Related work ${n}: label required`,
        focus: { index: i, field: "label", message: "Label required." },
      };
    }
    if (!d.url.startsWith("https://")) {
      return {
        ok: false,
        error: `Related work ${n}: URL must start with https://`,
        focus: {
          index: i,
          field: "url",
          message: "URL must start with https://.",
        },
      };
    }
  }
  return { ok: true, value: drafts };
}

/** Best-effort in-app href for a Plebly dependency ref. */
export function pleblyDepHref(ref: string): string {
  let path = ref.trim().replace(/^\/+/, "");
  if (!path) return "";
  if (!path.startsWith("proposals/")) {
    if (path.includes("/")) path = `proposals/${path}`;
    else path = `proposals/listed/${path}`;
  }
  if (!path.endsWith(".md")) path = `${path}.md`;
  return path;
}
