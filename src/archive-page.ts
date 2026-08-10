import {
  filterCompletedProposals,
} from "./completed-page";
import { filterDeclinedProposals } from "./declined-page";
import { listAllPublicProposals } from "./github";
import { statusPillHtml } from "./proposal-ui";
import { href, projectsHref, proposalHref } from "./router";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type ArchiveShell = (inner: string) => string;
export type ArchiveTab = "completed" | "declined";

export function archiveTabFromSearch(search = ""): ArchiveTab {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const tab = new URLSearchParams(q).get("tab");
  return tab === "declined" ? "declined" : "completed";
}

export function archiveHref(tab: ArchiveTab = "completed"): string {
  return tab === "declined"
    ? href("/archive", "?tab=declined")
    : href("/archive");
}

function rowHtml(p: Proposal, opts?: { showClaimer?: boolean }): string {
  const title = escapeHtml(p.title || p.id || "Untitled");
  const link = proposalHref(p.path, p.id);
  const target =
    typeof p.target_sats === "number"
      ? escapeHtml(formatSats(p.target_sats))
      : "—";
  const claimer =
    opts?.showClaimer && p.claimer
      ? `<span class="muted">Claimed by @${escapeHtml(
          String(p.claimer).replace(/^@/, ""),
        )}</span>`
      : "";
  return `<li class="declined-row">
    <a class="declined-title" href="${escapeHtml(link)}">${title}</a>
    <span class="declined-meta">${statusPillHtml(p.status)}${
      p.id ? `<span class="mono muted">${escapeHtml(p.id)}</span>` : ""
    }${claimer}<span class="muted">Target ${target}</span></span>
  </li>`;
}

function panelHtml(
  tab: ArchiveTab,
  proposals: Proposal[],
  loadError: boolean,
): string {
  if (loadError) {
    return `<p class="muted">Could not load archive.</p>`;
  }
  if (tab === "completed") {
    if (!proposals.length) {
      return `<div class="empty-state">
          <p class="empty-state-title">No completed projects yet</p>
          <p class="empty-state-body">Finished bounties appear here after public review and release.</p>
        </div>`;
    }
    return `<ul class="declined-list">${proposals
      .map((p) => rowHtml(p, { showClaimer: true }))
      .join("")}</ul>`;
  }
  if (!proposals.length) {
    return `<div class="empty-state">
          <p class="empty-state-title">No declined proposals yet</p>
          <p class="empty-state-body">Listings that fail a challenge or are closed without funding appear here.</p>
        </div>`;
  }
  return `<ul class="declined-list">${proposals.map((p) => rowHtml(p)).join("")}</ul>`;
}

function canonicalizeLegacyUrl(tab: ArchiveTab): void {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const leaf = path.split("/").pop() || "";
  if (leaf !== "completed" && leaf !== "declined") return;
  history.replaceState(null, "", archiveHref(tab));
}

export async function renderArchive(
  shell: ArchiveShell,
  tab: ArchiveTab = "completed",
): Promise<void> {
  canonicalizeLegacyUrl(tab);
  const app = document.querySelector<HTMLDivElement>("#app")!;

  let completed: Proposal[] = [];
  let declined: Proposal[] = [];
  let loadError = false;
  try {
    const all = await listAllPublicProposals();
    completed = filterCompletedProposals(all);
    declined = filterDeclinedProposals(all);
  } catch {
    loadError = true;
  }

  const active = tab === "declined" ? declined : completed;
  const lede =
    tab === "declined"
      ? `Closed or declined listings kept for public record (${declined.length}).`
      : `Finished projects kept for public record (${completed.length}). Discussion is read-only.`;

  const tabs = `<nav class="account-tabs archive-tabs" aria-label="Archive sections">
    <a href="${archiveHref("completed")}" class="account-tab${
      tab === "completed" ? " active" : ""
    }"${tab === "completed" ? ' aria-current="page"' : ""}>Completed${
      loadError ? "" : ` <span class="account-tab-count">${completed.length}</span>`
    }</a>
    <a href="${archiveHref("declined")}" class="account-tab${
      tab === "declined" ? " active" : ""
    }"${tab === "declined" ? ' aria-current="page"' : ""}>Declined${
      loadError ? "" : ` <span class="account-tab-count">${declined.length}</span>`
    }</a>
  </nav>`;

  app.innerHTML = shell(`
    <section class="wrap-wide declined-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Archive</p>
        <h1>Archive</h1>
        <p class="lede">${escapeHtml(lede)}</p>
      </header>
      ${tabs}
      ${panelHtml(tab, active, loadError)}
    </section>
  `);
}
