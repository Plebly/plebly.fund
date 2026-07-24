import { fetchWatches } from "./builder";
import { bindBuilderPanel, builderPanelHtml } from "./builder-panel";
import { CLAIM_FLOOR_SATS } from "./config";
import { profilePath, type AuthUser } from "./auth";
import { listListedProposals, proposalFromMarkdown } from "./github";
import { socialAccountLink } from "./icons";
import { addressBalanceSats } from "./mempool";
import { renderMarkdown } from "./markdown";
import {
  bindDonatePanel,
  bindProposalCopyButtons,
  donatePanelHtml,
  metaChipsHtml,
  milestonesHtml,
  onChainPanelHtml,
  proposalFundingBarHtml,
  sectionBodyHtml,
  statusClass,
  statusLabel,
} from "./proposal-ui";
import type { Proposal } from "./types";
import { escapeHtml } from "./util";

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

export async function renderProposalPage(
  path: string,
  shell: ProposalShell,
  user: AuthUser | null = null,
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
    const watches = user
      ? await fetchWatches().catch(() => [])
      : [];
    const watching = watches.some(
      (w) =>
        w.proposal_path === match.path ||
        w.proposal_id === match.id ||
        w.proposal_id === path.split("/").pop()?.replace(/\.md$/, ""),
    );

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
        </header>

        ${
          match.escrow_address
            ? proposalFundingBarHtml(balance, CLAIM_FLOOR_SATS, match.target_sats)
            : ""
        }

        <div class="proposal-layout">
          <aside class="proposal-sidebar">
            ${builderPanelHtml({ ...match, balance_sats: balance }, balance, watching)}
            ${donatePanelHtml(match)}
            ${onChainPanelHtml(match)}
            ${milestonesHtml(match.milestones)}
          </aside>

          <div class="proposal-sections">${sectionsHtml}</div>
        </div>
      </section>
    `);

    bindProposalCopyButtons(app);
    await bindBuilderPanel(app, {
      proposal: { ...match, balance_sats: balance },
      balance,
      user,
      watching,
    });
    if (match.escrow_address) {
      await bindDonatePanel(app, {
        address: match.escrow_address,
        proposalId: match.id,
        proposalPath: match.path,
      });
      if (wantsDonate) {
        app.querySelector("#donate")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  } catch (e) {
    app.innerHTML = shell(
      `<section class="wrap-wide detail proposal-page"><p class="error">${escapeHtml((e as Error).message)}</p></section>`,
    );
  }
}
