import {
  authFetch,
  loginChoicesHtml,
  submitProposal,
  updateProposal,
} from "./auth";
import { fetchClaimParams } from "./builder";
import {
  BITCOIN_NETWORK,
  PROPOSALS_RAW,
  SUBMISSION_FEE_SATS,
  WORKERS_API,
} from "./config";
import { bindFeePay, feePayHtml } from "./fee-pay";
import { extractBodySections, parseFrontMatter } from "./frontmatter";
import {
  clientCoverPrecheck,
  uploadProjectCover,
} from "./media";
import type { ShellContext } from "./profile-pages";
import {
  collectDependsOn,
  collectRelatedWork,
  dependsOnRowHtml,
  dependsOnSectionHtml,
  MAX_DEPENDS_ON,
  MAX_RELATED_WORK,
  relatedWorkRowHtml,
  relatedWorkSectionHtml,
  syncDependsOnKindUi,
  validateDependsOnDrafts,
  validateRelatedWorkDrafts,
} from "./propose-deps";
import {
  collectMilestoneDrafts,
  MAX_MILESTONES,
  milestoneEditorSectionHtml,
  milestoneRowHtml,
  milestonesAllocatedTotal,
  milestonesFundingHint,
  removeMilestoneRow,
  validateMilestoneDrafts,
  type MilestoneDraft,
} from "./propose-milestones";
import { parseTagList } from "./proposal-tags";
import { PROPOSAL_TEMPLATES } from "./proposal-templates";
import { href, proposalHref } from "./router";
import { bindTagInput, tagInputHtml } from "./tag-input";
import type {
  DependsOnEntry,
  ProposalMilestone,
  RelatedWorkEntry,
} from "./types";
import { EDITABLE_PROPOSAL_STATUSES } from "./types";
import { escapeHtml, formatSats } from "./util";

const PROPOSE_PATH = "/propose";

type Prefill = {
  path: string;
  id: string | null;
  title: string;
  proposal_type: "bounty" | "direct";
  tags: string[];
  parent_initiative: string | null;
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  notes: string;
  target_sats: number | null;
  cover_image: string | null;
  milestones: ProposalMilestone[];
  depends_on: DependsOnEntry[];
  related_work: RelatedWorkEntry[];
  status: string;
};

async function loadPrefill(editPath: string): Promise<Prefill | null> {
  let path = editPath.replace(/^\/+/, "");
  if (!path.startsWith("proposals/")) path = `proposals/${path}`;
  if (!path.endsWith(".md")) path = `${path}.md`;
  const res = await fetch(`${PROPOSALS_RAW}/${path}`);
  if (!res.ok) return null;
  const raw = await res.text();
  const { data, body } = parseFrontMatter(raw);
  const sections = extractBodySections(body);
  const status = String(data.status || "");
  if (!EDITABLE_PROPOSAL_STATUSES.has(status)) return null;
  const milestones = Array.isArray(data.milestones)
    ? (data.milestones as ProposalMilestone[])
    : [];
  const depends_on = Array.isArray(data.depends_on)
    ? (data.depends_on as DependsOnEntry[])
    : [];
  const related_work = Array.isArray(data.related_work)
    ? (data.related_work as RelatedWorkEntry[])
    : [];
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((t): t is string => typeof t === "string")
    : [];
  return {
    path,
    id: typeof data.id === "string" && data.id.trim() ? data.id.trim() : null,
    title: String(data.title || ""),
    proposal_type:
      String(data.proposal_type || "bounty").toLowerCase() === "direct"
        ? "direct"
        : "bounty",
    tags,
    parent_initiative:
      typeof data.parent_initiative === "string"
        ? data.parent_initiative
        : null,
    problem: sections.problem || "",
    deliverable: sections.deliverable || "",
    verification: sections.verification || "",
    out_of_scope: sections["out of scope"] || "",
    notes: sections.notes || "",
    target_sats:
      typeof data.target_sats === "number" ? data.target_sats : null,
    cover_image:
      typeof data.cover_image === "string" ? data.cover_image : null,
    milestones,
    depends_on,
    related_work,
    status,
  };
}

type BridgeSource = {
  owner: string;
  repo: string;
  number: number;
  html_url: string;
  author_login?: string | null;
};

async function loadBridgeSource(sourceUrl: string): Promise<{
  source_issue: BridgeSource;
  title: string;
  problem: string;
  draft: { pr_url: string } | null;
} | null> {
  const api = WORKERS_API.replace(/\/$/, "");
  const res = await authFetch(
    `${api}/bridge/source?url=${encodeURIComponent(sourceUrl)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as {
    source_issue: BridgeSource;
    title: string;
    problem: string;
    draft: { pr_url: string } | null;
  };
}

export async function renderPropose(ctx: ShellContext): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const params = new URLSearchParams(location.search);
  const editParam = params.get("edit");
  const sourceParam = params.get("source");
  const bridgeParam = params.get("bridge");
  const returnPath = editParam
    ? `${PROPOSE_PATH}?edit=${encodeURIComponent(editParam)}`
    : sourceParam
      ? `${PROPOSE_PATH}?bridge=1&source=${encodeURIComponent(sourceParam)}`
      : PROPOSE_PATH;

  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail propose-page">
        <h1>${editParam ? "Edit proposal" : "Start a project"}</h1>
        <p class="lede">Sign in to ${editParam ? "open an amend pull request" : "open a proposal pull request"}.</p>
        ${loginChoicesHtml(undefined, returnPath)}
        <p class="hint form-alt-link"><a href="https://github.com/Plebly/proposals/blob/main/template/proposal.md" target="_blank" rel="noreferrer">Or open a PR manually</a></p>
      </section>
    `);
    return;
  }

  let prefill: Prefill | null = null;
  let bridgeSource: BridgeSource | null = null;
  let bridgeDraftPr: string | null = null;
  if (editParam) {
    app.innerHTML = ctx.shell(
      `<section class="wrap detail propose-page"><p class="loading">Loading proposal…</p></section>`,
    );
    prefill = await loadPrefill(editParam);
    if (!prefill) {
      app.innerHTML = ctx.shell(`
        <section class="wrap detail propose-page">
          <h1>Cannot edit</h1>
          <p class="lede">This proposal is not on main yet, is past claim, or was not found. In-app edit works after the submission PR merges and before claim.</p>
          <p><a class="btn" href="${href("/")}">Browse projects</a></p>
        </section>
      `);
      return;
    }
  } else if (sourceParam && (bridgeParam === "1" || sourceParam.includes("github.com"))) {
    app.innerHTML = ctx.shell(
      `<section class="wrap detail propose-page"><p class="loading">Loading GitHub issue…</p></section>`,
    );
    const bridge = await loadBridgeSource(sourceParam);
    if (!bridge) {
      app.innerHTML = ctx.shell(`
        <section class="wrap detail propose-page">
          <h1>Cannot load issue</h1>
          <p class="lede">Install the Plebly GitHub App on that repository (required for private issues), or check the URL.</p>
          <p><a class="btn" href="${href("/propose")}">Start without bridge</a></p>
        </section>
      `);
      return;
    }
    bridgeSource = bridge.source_issue;
    bridgeDraftPr = bridge.draft?.pr_url || null;
    prefill = {
      path: "",
      id: null,
      title: bridge.title,
      proposal_type: "bounty",
      tags: [],
      parent_initiative: null,
      problem: bridge.problem,
      deliverable: "",
      verification: "",
      out_of_scope: "",
      notes: `Bridged from ${bridge.source_issue.html_url}`,
      target_sats: null,
      cover_image: null,
      milestones: [],
      depends_on: [],
      related_work: [
        {
          label: `GitHub #${bridge.source_issue.number}`,
          url: bridge.source_issue.html_url,
        },
      ],
      status: "pr_open",
    };
  }

  const isEdit = Boolean(editParam && prefill);
  const isBridge = Boolean(bridgeSource && !isEdit);
  const feeLabel = formatSats(SUBMISSION_FEE_SATS);
  const networkLabel = BITCOIN_NETWORK === "signet" ? "signet" : "mainnet";
  let feeAddress: string | null = null;
  if (!isEdit) {
    try {
      const params = await fetchClaimParams();
      feeAddress = params.fee_address;
    } catch {
      /* optional */
    }
  }

  app.innerHTML = ctx.shell(`
    <section class="wrap detail propose-page">
      <h1>${isEdit ? "Edit proposal" : isBridge ? "Complete bridged proposal" : "Start a project"}</h1>
      ${
        isBridge && bridgeSource
          ? `<div class="edit-banner" role="status">
            <p>Bridged from <a href="${escapeHtml(bridgeSource.html_url)}" target="_blank" rel="noreferrer">${escapeHtml(bridgeSource.owner)}/${escapeHtml(bridgeSource.repo)}#${bridgeSource.number}</a>${
              bridgeDraftPr
                ? ` · <a href="${escapeHtml(bridgeDraftPr)}" target="_blank" rel="noreferrer">draft PR</a>`
                : ""
            }</p>
            <p class="hint">Pay the submission fee and finish Deliverable / Verification / Out of scope. The draft PR is updated in place.</p>
          </div>`
          : isEdit
          ? `<div class="edit-banner" role="status">
              <p>Editing on main · status <span class="pill">${escapeHtml(prefill!.status)}</span></p>
              <p class="edit-banner-path mono">${escapeHtml(prefill!.path)}</p>
              <p class="edit-banner-actions">
                <a href="${proposalHref(prefill!.path, prefill!.id)}">← Back to project</a>
              </p>
            </div>`
          : `<p class="lede">Describe the work and pay the ${escapeHtml(feeLabel)} submission fee on ${escapeHtml(networkLabel)}.</p>`
      }

      <form id="propose-form" class="form-panel form-panel-wide">
        <fieldset class="form-block">
          <legend>Proposal</legend>
          ${
            isEdit
              ? ""
              : `<label class="field">
              <span>Start from template <em class="optional">(optional)</em></span>
              <select id="proposal-template">
                <option value="">Choose a starter template (fills the draft)…</option>
                ${PROPOSAL_TEMPLATES.map((template) => `<option value="${template.id}">${template.label}</option>`).join("")}
              </select>
            </label>`
          }
          <label class="field">
            <span>Title</span>
            <input name="title" required minlength="3" maxlength="200" placeholder="Short, specific name for the project" value="${escapeHtml(prefill?.title || "")}" />
          </label>
          <fieldset class="field propose-type">
            <span>Proposal type</span>
            <label class="radio-row"><input type="radio" name="proposal_type" value="bounty" ${String(prefill?.proposal_type || "bounty") !== "direct" ? "checked" : ""} /><span><strong>Bounty</strong>: open to claim by a builder</span></label>
            <label class="radio-row"><input type="radio" name="proposal_type" value="direct" ${String(prefill?.proposal_type) === "direct" ? "checked" : ""} /><span><strong>Direct</strong>: you are the recipient (no claim step)</span></label>
          </fieldset>
          <div class="field">
            <span>Tags <em class="optional">(optional)</em></span>
            ${tagInputHtml({
              id: "propose-tags",
              name: "tags",
              tags: prefill?.tags || [],
              placeholder: "Type a tag, then Enter",
            })}
          </div>
          <label class="field">
            <span>Commons / parent initiative <em class="optional">(optional)</em></span>
            <input name="parent_initiative" maxlength="200" placeholder="e.g. Bitcoin Core Commons" value="${escapeHtml(prefill?.parent_initiative || "")}" />
            <span class="field-hint">Use a shared initiative name to group related proposals. This does not create governance authority.</span>
          </label>
          <div class="field cover-field">
            <span>Cover image <em class="optional">(optional)</em></span>
            <input type="file" id="propose-cover-input" class="cover-file-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden />
            <div class="cover-picker" id="propose-cover-picker">
              <button type="button" class="cover-pick-btn" id="propose-cover-pick">
                <span class="cover-pick-label">Choose cover</span>
                <span class="cover-pick-meta">JPEG, PNG, or WebP · max 2 MiB · 16:9 works best</span>
              </button>
            </div>
            <div class="cover-preview" id="propose-cover-preview" hidden>
              <div class="cover-preview-frame">
                <img id="propose-cover-img" alt="" />
                <div class="cover-preview-status" id="propose-cover-status" hidden></div>
              </div>
              <div class="cover-preview-actions">
                <button type="button" class="btn ghost" id="propose-cover-replace">Replace</button>
                <button type="button" class="btn ghost" id="propose-cover-clear">Remove</button>
              </div>
            </div>
            <span class="field-hint" id="propose-cover-hint" hidden></span>
          </div>
          <label class="field">
            <span>Problem &amp; audience</span>
            <textarea name="problem" required minlength="40" rows="4" placeholder="What problem are you solving? Who benefits? Why is this good for Bitcoin?">${escapeHtml(prefill?.problem || "")}</textarea>
          </label>
          <label class="field">
            <span>Plan &amp; deliverables</span>
            <textarea name="deliverable" required minlength="40" rows="5" placeholder="Concrete artifacts you will produce: code, docs, research, designs. Include license intent (FOSS).">${escapeHtml(prefill?.deliverable || "")}</textarea>
          </label>
          <label class="field">
            <span>Verification</span>
            <textarea name="verification" required minlength="40" rows="4" placeholder="Steps a reviewer can follow to confirm completion: commands, URLs, acceptance criteria.">${escapeHtml(prefill?.verification || "")}</textarea>
            <span class="field-hint">Two independent reviewers should reach the same yes/no conclusion. Numbered steps (1. 2.) render as a checklist on the project page.</span>
          </label>
          <label class="field">
            <span>Out of scope</span>
            <textarea name="out_of_scope" required minlength="10" rows="3" placeholder="What this project explicitly does not include.">${escapeHtml(prefill?.out_of_scope || "")}</textarea>
          </label>
          <label class="field">
            <span>Notes <em class="optional">(optional)</em></span>
            <textarea name="notes" maxlength="4000" rows="3" placeholder="Freeform context. Prefer Related work below for structured https links.">${escapeHtml(prefill?.notes || "")}</textarea>
          </label>
        </fieldset>

        <fieldset class="form-block">
          <legend>Funding</legend>
          <label class="field">
            <span>Target funding <em class="optional">(optional)</em></span>
            <input name="target_sats" id="propose-target-sats" type="number" min="0" step="1" placeholder="e.g. 5000000" value="${prefill?.target_sats != null ? escapeHtml(String(prefill.target_sats)) : ""}" />
            <span class="field-hint">Targets ≥ 1,000,000 sats require at least one milestone.</span>
          </label>
          ${
            isEdit
              ? ""
              : `<div class="field">
            <span>Submission fee</span>
            ${feePayHtml({
              id: "propose-fee",
              amountSats: SUBMISSION_FEE_SATS,
              address: feeAddress,
              txidName: "submission_fee_txid",
              note: "Required to open a proposal PR. Exact amount on-chain.",
            })}
          </div>`
          }
        </fieldset>

        ${milestoneEditorSectionHtml()}
        ${dependsOnSectionHtml()}
        ${relatedWorkSectionHtml()}

        <div class="form-actions">
          <button type="submit" class="btn">${isEdit ? "Open amend PR" : isBridge ? "Pay fee & update draft PR" : "Open proposal PR"}</button>
          ${isEdit ? `<a class="btn ghost" href="${proposalHref(prefill!.path, prefill!.id)}">Cancel</a>` : ""}
        </div>
        <p class="form-msg" id="propose-msg" hidden></p>
      </form>
    </section>
  `);

  const feePay = isEdit ? null : await bindFeePay(document, "propose-fee");
  const form = document.getElementById("propose-form") as HTMLFormElement;
  const msg = document.getElementById("propose-msg")!;
  const milestonesList = document.getElementById("milestones-list")!;
  const milestonesEmpty = document.getElementById("milestones-empty");
  const milestonesTotal = document.getElementById("milestones-total");
  const milestonesHint = document.getElementById("milestones-funding-hint");
  const targetInput = document.getElementById(
    "propose-target-sats",
  ) as HTMLInputElement | null;
  const dependsList = document.getElementById("depends-on-list")!;
  const dependsEmpty = document.getElementById("depends-on-empty");
  const relatedList = document.getElementById("related-work-list")!;
  const relatedEmpty = document.getElementById("related-work-empty");

  const tagsInput = bindTagInput(document, "propose-tags");

  const templateSelect = document.getElementById(
    "proposal-template",
  ) as HTMLSelectElement | null;
  templateSelect?.addEventListener("change", () => {
    const template = PROPOSAL_TEMPLATES.find(
      (candidate) => candidate.id === templateSelect.value,
    );
    if (!template) return;
    const overwrite = [
      "title",
      "problem",
      "deliverable",
      "verification",
      "out_of_scope",
    ].some((name) => {
      const input = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
      return Boolean(input?.value.trim());
    }) || Boolean(tagsInput?.getTags().length);
    if (overwrite && !window.confirm("Use this template to replace the draft fields?")) {
      templateSelect.value = "";
      return;
    }
    (form.elements.namedItem("title") as HTMLInputElement).value = template.title;
    (form.elements.namedItem("problem") as HTMLTextAreaElement).value = template.problem;
    (form.elements.namedItem("deliverable") as HTMLTextAreaElement).value = template.deliverable;
    (form.elements.namedItem("verification") as HTMLTextAreaElement).value = template.verification;
    (form.elements.namedItem("out_of_scope") as HTMLTextAreaElement).value = template.out_of_scope;
    tagsInput?.setTags(template.tags);
  });

  const syncEmpty = (list: HTMLElement, empty: HTMLElement | null) => {
    if (!empty) return;
    empty.hidden = list.children.length > 0;
  };

  const readTargetSats = (): number | null => {
    const raw = targetInput?.value.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const addMilestoneBtn = document.getElementById(
    "add-milestone-btn",
  ) as HTMLButtonElement | null;
  const addDependsBtn = document.getElementById(
    "add-depends-on-btn",
  ) as HTMLButtonElement | null;
  const addRelatedBtn = document.getElementById(
    "add-related-work-btn",
  ) as HTMLButtonElement | null;

  const syncAddButtons = () => {
    const msCount = milestonesList.querySelectorAll(".milestone-editor-row").length;
    if (addMilestoneBtn) {
      addMilestoneBtn.disabled = msCount >= MAX_MILESTONES;
      addMilestoneBtn.title =
        msCount >= MAX_MILESTONES
          ? `Maximum ${MAX_MILESTONES} milestones`
          : "";
    }
    const depCount = dependsList.querySelectorAll(".dep-editor-row").length;
    if (addDependsBtn) {
      addDependsBtn.disabled = depCount >= MAX_DEPENDS_ON;
      addDependsBtn.title =
        depCount >= MAX_DEPENDS_ON
          ? `Maximum ${MAX_DEPENDS_ON} dependencies`
          : "";
    }
    const relCount = relatedList.querySelectorAll(".dep-editor-row").length;
    if (addRelatedBtn) {
      addRelatedBtn.disabled = relCount >= MAX_RELATED_WORK;
      addRelatedBtn.title =
        relCount >= MAX_RELATED_WORK
          ? `Maximum ${MAX_RELATED_WORK} related links`
          : "";
    }
  };

  const refreshMilestoneTotal = () => {
    const drafts = collectMilestoneDrafts(milestonesList);
    const total = milestonesAllocatedTotal(drafts);
    const rowCount = milestonesList.querySelectorAll(
      ".milestone-editor-row",
    ).length;
    if (milestonesTotal) {
      milestonesTotal.textContent = rowCount
        ? `${rowCount} stage${rowCount === 1 ? "" : "s"}${
            drafts.length
              ? ` · ${formatSats(total)} allocated`
              : ""
          }`
        : "";
    }
    if (milestonesHint) {
      const hint = milestonesFundingHint(readTargetSats(), total, drafts.length);
      milestonesHint.hidden = !hint;
      milestonesHint.textContent = hint;
    }
    syncEmpty(milestonesList, milestonesEmpty);
    syncAddButtons();
  };

  const renumberDeps = (list: HTMLElement, label: string) => {
    list.querySelectorAll<HTMLElement>(".dep-editor-row").forEach((row, i) => {
      row.dataset.index = String(i);
      const n = row.querySelector(".milestone-editor-n");
      if (n) n.textContent = `${label} ${i + 1}`;
    });
  };

  // Event delegation so Remove always works for newly added rows.
  milestonesList.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.(".remove-milestone");
    if (!btn || !milestonesList.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const row = btn.closest(".milestone-editor-row") as HTMLElement | null;
    if (!row) return;
    removeMilestoneRow(milestonesList, row);
    refreshMilestoneTotal();
  });
  milestonesList.addEventListener("input", () => refreshMilestoneTotal());

  dependsList.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.(".remove-dep");
    if (!btn || !dependsList.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    btn.closest(".dep-editor-row")?.remove();
    renumberDeps(dependsList, "Dependency");
    syncEmpty(dependsList, dependsEmpty);
    syncAddButtons();
  });
  dependsList.addEventListener("change", (e) => {
    const t = e.target as HTMLElement | null;
    const row = t?.closest?.(".dep-editor-row") as HTMLElement | null;
    if (row && t?.classList.contains("dep-kind")) syncDependsOnKindUi(row);
  });

  relatedList.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.(".remove-dep");
    if (!btn || !relatedList.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    btn.closest(".dep-editor-row")?.remove();
    renumberDeps(relatedList, "Related");
    syncEmpty(relatedList, relatedEmpty);
    syncAddButtons();
  });

  const addMilestone = (draft?: Partial<MilestoneDraft>) => {
    const index = milestonesList.querySelectorAll(".milestone-editor-row").length;
    if (index >= MAX_MILESTONES) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = `At most ${MAX_MILESTONES} milestones.`;
      return;
    }
    milestonesList.insertAdjacentHTML(
      "beforeend",
      milestoneRowHtml(index, draft),
    );
    refreshMilestoneTotal();
  };

  addMilestoneBtn?.addEventListener("click", () => {
    addMilestone();
  });
  targetInput?.addEventListener("input", refreshMilestoneTotal);

  addDependsBtn?.addEventListener("click", () => {
    const index = dependsList.querySelectorAll(".dep-editor-row").length;
    if (index >= MAX_DEPENDS_ON) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = `At most ${MAX_DEPENDS_ON} dependencies.`;
      return;
    }
    dependsList.insertAdjacentHTML("beforeend", dependsOnRowHtml(index));
    syncEmpty(dependsList, dependsEmpty);
    syncAddButtons();
  });

  addRelatedBtn?.addEventListener("click", () => {
    const index = relatedList.querySelectorAll(".dep-editor-row").length;
    if (index >= MAX_RELATED_WORK) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = `At most ${MAX_RELATED_WORK} related links.`;
      return;
    }
    relatedList.insertAdjacentHTML("beforeend", relatedWorkRowHtml(index));
    syncEmpty(relatedList, relatedEmpty);
    syncAddButtons();
  });

  if (prefill?.milestones.length) {
    prefill.milestones.forEach((m, i) => {
      addMilestone({
        id: m.id || `m${i + 1}`,
        deliverable: m.deliverable,
        verification: m.verification,
        out_of_scope: m.out_of_scope,
        allocation_sats: m.allocation_sats,
        deadline: String(m.deadline || "").slice(0, 10),
        dependencies: m.dependencies,
      });
    });
  } else {
    refreshMilestoneTotal();
  }

  if (prefill?.depends_on.length) {
    prefill.depends_on.forEach((d, i) => {
      dependsList.insertAdjacentHTML("beforeend", dependsOnRowHtml(i, d));
      const row = dependsList.lastElementChild as HTMLElement | null;
      if (row) syncDependsOnKindUi(row);
    });
  }
  syncEmpty(dependsList, dependsEmpty);

  if (prefill?.related_work.length) {
    prefill.related_work.forEach((d, i) => {
      relatedList.insertAdjacentHTML("beforeend", relatedWorkRowHtml(i, d));
    });
  }
  syncEmpty(relatedList, relatedEmpty);
  syncAddButtons();

  const coverInput = document.getElementById(
    "propose-cover-input",
  ) as HTMLInputElement;
  const coverPicker = document.getElementById("propose-cover-picker")!;
  const coverPreview = document.getElementById("propose-cover-preview")!;
  const coverImg = document.getElementById(
    "propose-cover-img",
  ) as HTMLImageElement;
  const coverStatus = document.getElementById("propose-cover-status")!;
  const coverHint = document.getElementById("propose-cover-hint")!;
  let coverUrl: string | null = prefill?.cover_image || null;
  let coverObjectUrl: string | null = null;
  let coverUploading = false;

  const setHint = (text: string, kind: "" | "error" | "ok" = "") => {
    if (!text) {
      coverHint.hidden = true;
      coverHint.textContent = "";
      coverHint.className = "field-hint";
      return;
    }
    coverHint.hidden = false;
    coverHint.textContent = text;
    coverHint.className =
      kind === "error"
        ? "field-hint error"
        : kind === "ok"
          ? "field-hint ok"
          : "field-hint";
  };

  const setPreviewStatus = (text: string, kind: "" | "busy" | "error" = "") => {
    if (!text) {
      coverStatus.hidden = true;
      coverStatus.textContent = "";
      coverStatus.className = "cover-preview-status";
      return;
    }
    coverStatus.hidden = false;
    coverStatus.textContent = text;
    coverStatus.className = `cover-preview-status${kind ? ` is-${kind}` : ""}`;
  };

  const showPicker = () => {
    coverPicker.hidden = false;
    coverPreview.hidden = true;
  };

  const showPreview = () => {
    coverPicker.hidden = true;
    coverPreview.hidden = false;
  };

  if (coverUrl) {
    coverImg.src = coverUrl;
    coverImg.alt = "Cover";
    showPreview();
  }

  const clearCover = () => {
    coverUrl = null;
    coverUploading = false;
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = null;
    }
    coverImg.removeAttribute("src");
    coverImg.alt = "";
    setPreviewStatus("");
    coverInput.value = "";
    showPicker();
    setHint("");
  };

  const openFilePicker = () => {
    if (coverUploading) return;
    coverInput.click();
  };

  document.getElementById("propose-cover-pick")?.addEventListener("click", openFilePicker);
  document.getElementById("propose-cover-replace")?.addEventListener("click", openFilePicker);
  document.getElementById("propose-cover-clear")?.addEventListener("click", () => {
    if (coverUploading) return;
    clearCover();
  });

  coverInput.addEventListener("change", async () => {
    const file = coverInput.files?.[0];
    if (!file) return;
    const pre = clientCoverPrecheck(file);
    if (pre) {
      clearCover();
      setHint(pre, "error");
      return;
    }
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = URL.createObjectURL(file);
    coverImg.src = coverObjectUrl;
    coverImg.alt = "Cover preview";
    coverUrl = null;
    coverUploading = true;
    showPreview();
    setHint("");
    setPreviewStatus("Uploading…", "busy");
    try {
      const uploaded = await uploadProjectCover(file);
      coverUrl = uploaded.url;
      coverUploading = false;
      setPreviewStatus("");
      setHint("Cover ready.", "ok");
    } catch (err) {
      const e = err as Error & { code?: string };
      coverUploading = false;
      clearCover();
      if (e.code === "MEDIA_DISABLED") {
        setHint("Cover uploads are not enabled yet. Continue without an image.");
        return;
      }
      setHint(e.message, "error");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (coverUploading) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = "Wait for the cover upload to finish, or remove it.";
      return;
    }

    const fd = new FormData(form);
    const targetRaw = fd.get("target_sats");
    const target_sats =
      targetRaw && String(targetRaw).length ? Number(targetRaw) : null;
    const drafts = collectMilestoneDrafts(milestonesList);
    const checked = validateMilestoneDrafts(drafts, target_sats);
    if (!checked.ok) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = checked.error;
      document.getElementById("milestones-block")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    const depDrafts = collectDependsOn(dependsList);
    const depOk = validateDependsOnDrafts(depDrafts);
    if (!depOk.ok) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = depOk.error;
      return;
    }
    const relDrafts = collectRelatedWork(relatedList);
    const relOk = validateRelatedWorkDrafts(relDrafts);
    if (!relOk.ok) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = relOk.error;
      return;
    }

    const tags = tagsInput?.getTags() || parseTagList(String(fd.get("tags") || ""));
    const author = {
      title: String(fd.get("title") || ""),
      proposal_type:
        String(fd.get("proposal_type") || "bounty") === "direct"
          ? ("direct" as const)
          : ("bounty" as const),
      tags,
      parent_initiative: String(fd.get("parent_initiative") || "").trim() || null,
      problem: String(fd.get("problem") || ""),
      deliverable: String(fd.get("deliverable") || ""),
      verification: String(fd.get("verification") || ""),
      out_of_scope: String(fd.get("out_of_scope") || ""),
      target_sats,
      cover_image: coverUrl,
      notes: String(fd.get("notes") || "").trim() || null,
      milestones: checked.milestones,
      depends_on: depOk.value,
      related_work: relOk.value,
    };

    if (!isEdit) {
      const feeTxid = feePay?.getTxid() || "";
      if (!/^[0-9a-fA-F]{64}$/.test(feeTxid)) {
        feePay?.setStep("txid");
        msg.hidden = false;
        msg.className = "form-msg error";
        msg.textContent =
          "Paste the 64-character submission fee txid after you've sent the payment.";
        return;
      }
      msg.hidden = false;
      msg.className = "form-msg";
      msg.textContent = "Opening pull request…";
      try {
        const result = await submitProposal({
          ...author,
          submission_fee_txid: feeTxid,
          source_issue: bridgeSource,
        });
        showProposeSuccess({
          title: isBridge ? "Bridge proposal funded" : "Proposal submitted",
          body: isBridge
            ? "Your draft PR was updated with the fee and full fields. It becomes listed after merge + escrow allocate; the source issue then gets the funding comment."
            : "Your submission pull request is open. It becomes editable in-app after merge to main.",
          prUrl: result.pr_url,
          backHref: href("/"),
          backLabel: "Browse projects",
        });
      } catch (err) {
        msg.className = "form-msg error";
        msg.textContent = (err as Error).message;
      }
      return;
    }

    msg.hidden = false;
    msg.className = "form-msg";
    msg.textContent = "Opening amend pull request…";
    try {
      const result = await updateProposal({
        ...author,
        proposal_path: prefill!.path,
      });
      showProposeSuccess({
        title: "Amend submitted",
        body: "Your amend pull request is open. Lifecycle fields stay intact until merge.",
        prUrl: result.pr_url,
        backHref: proposalHref(prefill!.path, prefill!.id),
        backLabel: "Back to project",
      });
    } catch (err) {
      msg.className = "form-msg error";
      msg.textContent = (err as Error).message;
    }
  });
}

function showProposeSuccess(opts: {
  title: string;
  body: string;
  prUrl?: string;
  backHref: string;
  backLabel: string;
}): void {
  const section = document.querySelector(".propose-page");
  if (!section) return;
  const pr = opts.prUrl
    ? `<p class="propose-success-pr"><a href="${escapeHtml(opts.prUrl)}" target="_blank" rel="noreferrer">${escapeHtml(opts.prUrl)}</a></p>`
    : "";
  section.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-inner">
        <p class="empty-state-title">${escapeHtml(opts.title)}</p>
        <p class="empty-state-body">${escapeHtml(opts.body)}</p>
        ${pr}
        <p class="propose-success-actions">
          <a class="btn" href="${opts.backHref}">${escapeHtml(opts.backLabel)}</a>
          <a class="btn ghost" href="${href("/propose")}">Start another</a>
        </p>
      </div>
    </div>
  `;
}
