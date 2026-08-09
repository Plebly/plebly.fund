import { listAllPublicProposals } from "./github";
import { statusPillHtml } from "./proposal-ui";
import { projectsHref, proposalHref } from "./router";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type DeclinedShell = (inner: string) => string;

function isDeclinedStatus(status: string | undefined): boolean {
  return status === "declined" || status === "declined_fundable";
}

export function filterDeclinedProposals(proposals: Proposal[]): Proposal[] {
  return proposals
    .filter((p) => isDeclinedStatus(p.status) || p.path.includes("/declined/"))
    .sort((a, b) => (b.id || "").localeCompare(a.id || ""));
}

function rowHtml(p: Proposal): string {
  const title = escapeHtml(p.title || p.id || "Untitled");
  const link = proposalHref(p.path, p.id);
  const target =
    typeof p.target_sats === "number"
      ? escapeHtml(formatSats(p.target_sats))
      : "—";
  return `<li class="declined-row">
    <a class="declined-title" href="${escapeHtml(link)}">${title}</a>
    <span class="declined-meta">${statusPillHtml(p.status)}${
      p.id ? `<span class="mono muted">${escapeHtml(p.id)}</span>` : ""
    }<span class="muted">Target ${target}</span></span>
  </li>`;
}

export async function renderDeclined(shell: DeclinedShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  let rows = "";
  let count = 0;
  try {
    const declined = filterDeclinedProposals(await listAllPublicProposals());
    count = declined.length;
    rows = declined.length
      ? `<ul class="declined-list">${declined.map(rowHtml).join("")}</ul>`
      : `<div class="empty-state">
          <p class="empty-state-title">No declined proposals yet</p>
          <p class="empty-state-body">Listings that fail a challenge or are closed without funding appear here.</p>
        </div>`;
  } catch {
    rows = `<p class="muted">Could not load declined archive.</p>`;
  }

  app.innerHTML = shell(`
    <section class="wrap-wide declined-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Archive</p>
        <h1>Declined</h1>
        <p class="lede">Closed or declined listings kept for public record (${count}).</p>
      </header>
      ${rows}
    </section>
  `);
}
