import { CLAIM_FLOOR_SATS } from "./config";
import { profilePath } from "./auth";
import { listListedProposals } from "./github";
import { socialAccountLink } from "./icons";
import { addressBalanceSats } from "./mempool";
import { renderMarkdown } from "./markdown";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type ProposalShell = (inner: string) => string;

function progressHtml(balance: number, floor: number): string {
  const pct = Math.min(100, Math.round((balance / floor) * 100));
  return `<div class="proposal-progress" title="${formatSats(balance)} funded"><span style="width:${pct}%"></span></div>`;
}

function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+\n+/, "").trim();
}

function proposalSectionsHtml(markdown: string): string {
  const md = stripLeadingTitle(markdown);
  const chunks = md.split(/^##\s+/m).filter((c) => c.trim());

  if (chunks.length === 0) {
    return `<section class="proposal-section"><div class="prose-rich">${renderMarkdown(md)}</div></section>`;
  }

  return chunks
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
      const body = (nl === -1 ? "" : chunk.slice(nl + 1)).trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return `<section class="proposal-section" id="${escapeHtml(id)}">
        <h2 class="proposal-section-title">${escapeHtml(title)}</h2>
        <div class="prose-rich">${renderMarkdown(body)}</div>
      </section>`;
    })
    .join("");
}

function fundingStatsHtml(
  balance: number | undefined,
  target: number | null,
  floor: number,
): string {
  const funded =
    balance != null
      ? `<div class="proposal-stat">
          <span class="proposal-stat-label">Funded</span>
          <span class="proposal-stat-value sats">${formatSats(balance)}</span>
        </div>`
      : "";
  const targetHtml =
    target != null
      ? `<div class="proposal-stat">
          <span class="proposal-stat-label">Target</span>
          <span class="proposal-stat-value sats">${formatSats(target)}</span>
        </div>`
      : "";
  return `<div class="proposal-stats">
      ${funded}
      <div class="proposal-stat">
        <span class="proposal-stat-label">Claim floor</span>
        <span class="proposal-stat-value sats">${formatSats(floor)}</span>
      </div>
      ${targetHtml}
    </div>`;
}

export async function renderProposalPage(
  path: string,
  shell: ProposalShell,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(
    `<section class="wrap-wide detail proposal-page"><p class="loading">Loading…</p></section>`,
  );

  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/Plebly/proposals/main/${path}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const proposals = await listListedProposals();
    const listed = proposals.find((p) => p.path === path);
    const match: Proposal =
      listed ||
      ({
        id: path,
        title: path,
        status: "unknown",
        path,
        target_sats: null,
        escrow_address: null,
        submission_fee_txid: null,
        body: raw,
      } satisfies Proposal);

    const bodyMd = listed?.body ?? raw.replace(/^---[\s\S]*?---\n?/, "").trim();
    const sectionsHtml = proposalSectionsHtml(bodyMd);

    let balance: number | undefined;
    if (match.escrow_address) {
      try {
        balance = await addressBalanceSats(match.escrow_address);
      } catch {
        /* ignore */
      }
    }

    const proposer = match.proposer;
    const proposerMeta = proposer?.username
      ? `<a href="${profilePath(proposer.username)}">${escapeHtml(proposer.username)}</a>`
      : proposer?.github
        ? socialAccountLink(
            "github",
            `https://github.com/${proposer.github}`,
            proposer.github,
          )
        : "";

    const progressBlock =
      balance != null
        ? progressHtml(balance, CLAIM_FLOOR_SATS)
        : `<div class="proposal-progress proposal-progress-empty"><span style="width:0"></span></div>`;

    const escrowBlock = match.escrow_address
      ? `<div class="proposal-escrow">
          <span class="proposal-stat-label">Escrow</span>
          <code class="mono">${escapeHtml(match.escrow_address)}</code>
        </div>`
      : "";

    app.innerHTML = shell(`
      <section class="wrap-wide detail proposal-page">
        <a class="back-link" href="#/">← Bounties</a>

        <header class="proposal-hero">
          <div class="proposal-hero-top">
            <h1>${escapeHtml(match.title)}</h1>
            <span class="pill pill-status">${escapeHtml(String(match.status))}</span>
          </div>
          ${proposerMeta ? `<div class="proposal-meta">${proposerMeta}</div>` : ""}
        </header>

        <div class="proposal-funding">
          ${fundingStatsHtml(balance, match.target_sats, CLAIM_FLOOR_SATS)}
          ${progressBlock}
          ${escrowBlock}
        </div>

        <div class="proposal-sections">${sectionsHtml}</div>
      </section>
    `);
  } catch (e) {
    app.innerHTML = shell(
      `<section class="wrap-wide detail proposal-page"><p class="error">${escapeHtml((e as Error).message)}</p></section>`,
    );
  }
}
