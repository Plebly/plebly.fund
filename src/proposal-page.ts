import { CLAIM_FLOOR_SATS } from "./config";
import { profilePath } from "./auth";
import { listListedProposals, proposalFromMarkdown } from "./github";
import { socialAccountLink } from "./icons";
import { addressBalanceSats } from "./mempool";
import { renderMarkdown } from "./markdown";
import {
  bindDonatePanel,
  bindProposalCopyButtons,
  donatePanelHtml,
  fundingProgressHtml,
  metaChipsHtml,
  milestonesHtml,
  onChainPanelHtml,
  sectionBodyHtml,
  statusClass,
  statusLabel,
} from "./proposal-ui";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type ProposalShell = (inner: string) => string;

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
      const sectionClass =
        id === "verification"
          ? "proposal-section proposal-section-verify"
          : id === "out-of-scope"
            ? "proposal-section proposal-section-muted"
            : "proposal-section";
      return `<section class="${sectionClass}" id="${escapeHtml(id)}">
        <h2 class="proposal-section-title">${escapeHtml(title)}</h2>
        ${sectionBodyHtml(title, body, renderMarkdown)}
      </section>`;
    })
    .join("");
}

function fundingStatsHtml(
  balance: number | undefined,
  target: number | null,
  floor: number,
): string {
  return `<div class="proposal-stats">
      <div class="proposal-stat proposal-stat-primary">
        <span class="proposal-stat-label">Funded</span>
        <span class="proposal-stat-value sats">${balance != null ? formatSats(balance) : "—"}</span>
      </div>
      <div class="proposal-stat">
        <span class="proposal-stat-label">Claim floor</span>
        <span class="proposal-stat-value sats">${formatSats(floor)}</span>
      </div>
      ${
        target != null
          ? `<div class="proposal-stat">
        <span class="proposal-stat-label">Target</span>
        <span class="proposal-stat-value sats">${formatSats(target)}</span>
      </div>`
          : ""
      }
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
    const match: Proposal = listed || proposalFromMarkdown(raw, path);
    const bodyMd = match.body;
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

    const wantsDonate = /[?&]donate(?:&|$)/.test(location.hash);

    app.innerHTML = shell(`
      <section class="wrap-wide detail proposal-page">
        <a class="back-link" href="#/">← Projects</a>

        <header class="proposal-hero">
          <div class="proposal-hero-top">
            <h1>${escapeHtml(match.title)}</h1>
            <span class="pill pill-status ${statusClass(String(match.status))}">${escapeHtml(statusLabel(String(match.status)))}</span>
          </div>
          ${metaChipsHtml(match)}
          ${proposerMeta ? `<div class="proposal-meta">Proposed by ${proposerMeta}</div>` : ""}
          ${
            match.escrow_address
              ? `<div class="proposal-hero-donate">
            <button type="button" class="btn" id="scroll-donate">Donate to this project</button>
          </div>`
              : ""
          }
        </header>

        <div class="proposal-layout">
          <aside class="proposal-sidebar">
            ${donatePanelHtml(match)}
            <div class="proposal-funding">
              ${fundingStatsHtml(balance, match.target_sats, CLAIM_FLOOR_SATS)}
              ${fundingProgressHtml(balance, CLAIM_FLOOR_SATS, match.target_sats)}
            </div>
            ${onChainPanelHtml(match)}
            ${milestonesHtml(match.milestones)}
          </aside>

          <div class="proposal-sections">${sectionsHtml}</div>
        </div>
      </section>
    `);

    bindProposalCopyButtons(app);
    if (match.escrow_address) {
      await bindDonatePanel(app, {
        address: match.escrow_address,
        proposalId: match.id,
        proposalPath: match.path,
      });
      const scrollDonate = () =>
        app.querySelector("#donate")?.scrollIntoView({ behavior: "smooth", block: "start" });
      app.querySelector("#scroll-donate")?.addEventListener("click", scrollDonate);
      if (wantsDonate) scrollDonate();
    }
  } catch (e) {
    app.innerHTML = shell(
      `<section class="wrap-wide detail proposal-page"><p class="error">${escapeHtml((e as Error).message)}</p></section>`,
    );
  }
}
