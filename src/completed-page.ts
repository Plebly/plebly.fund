import { listAllPublicProposals } from "./github";
import { statusPillHtml } from "./proposal-ui";
import { href, proposalHref } from "./router";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type CompletedShell = (inner: string) => string;

export function filterCompletedProposals(proposals: Proposal[]): Proposal[] {
  return proposals
    .filter(
      (p) =>
        String(p.status) === "completed" || p.path.includes("/completed/"),
    )
    .sort((a, b) => (b.id || "").localeCompare(a.id || ""));
}

function rowHtml(p: Proposal): string {
  const title = escapeHtml(p.title || p.id || "Untitled");
  const link = proposalHref(p.path, p.id);
  const target =
    typeof p.target_sats === "number"
      ? escapeHtml(formatSats(p.target_sats))
      : "—";
  const claimer = p.claimer
    ? `<span class="muted">Claimed by @${escapeHtml(String(p.claimer).replace(/^@/, ""))}</span>`
    : "";
  return `<li class="declined-row">
    <a class="declined-title" href="${escapeHtml(link)}">${title}</a>
    <span class="declined-meta">${statusPillHtml(p.status)}${
      p.id ? `<span class="mono muted">${escapeHtml(p.id)}</span>` : ""
    }${claimer}<span class="muted">Target ${target}</span></span>
  </li>`;
}

export async function renderCompleted(shell: CompletedShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  let rows = "";
  let count = 0;
  try {
    const completed = filterCompletedProposals(await listAllPublicProposals());
    count = completed.length;
    rows = completed.length
      ? `<ul class="declined-list">${completed.map(rowHtml).join("")}</ul>`
      : `<div class="empty-state">
          <p class="empty-state-title">No completed projects yet</p>
          <p class="empty-state-body">Finished bounties appear here after public review and release.</p>
        </div>`;
  } catch {
    rows = `<p class="muted">Could not load completed archive.</p>`;
  }

  app.innerHTML = shell(`
    <section class="wrap-wide declined-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${href("/")}">Projects</a> · Archive</p>
        <h1>Completed</h1>
        <p class="lede">Finished projects kept for public record (${count}). Discussion is read-only.</p>
      </header>
      ${rows}
    </section>
  `);
}
