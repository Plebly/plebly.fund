import {
  BITCOIN_NETWORK,
  CLAIM_FLOOR_SATS,
  PLATFORM_FEE_PERCENT,
  SUBMISSION_FEE_SATS,
} from "./config";
import { listListedProposals } from "./github";
import { pleblySocialAccountsHtml } from "./icons";
import { addressBalanceSats } from "./mempool";
import { statusClass, statusLabel } from "./proposal-ui";
import type { Proposal } from "./types";
import { escapeHtml, formatSats, proposalHref } from "./util";

export type HomeShell = (inner: string) => string;

function networkBadgeHtml(): string {
  const isSignet = BITCOIN_NETWORK === "signet";
  return `<span class="network-badge ${isSignet ? "network-badge-test" : ""}">${isSignet ? "Signet testnet" : "Mainnet"}</span>`;
}

function homeStatsHtml(): string {
  return `<div class="home-stats">
    <article class="home-stat">
      <span class="home-stat-label">Claim floor</span>
      <span class="home-stat-value sats">${formatSats(CLAIM_FLOOR_SATS)}</span>
    </article>
    <article class="home-stat">
      <span class="home-stat-label">Submission fee</span>
      <span class="home-stat-value sats">${formatSats(SUBMISSION_FEE_SATS)}</span>
    </article>
    <article class="home-stat">
      <span class="home-stat-label">Platform fee</span>
      <span class="home-stat-value">${PLATFORM_FEE_PERCENT}%</span>
    </article>
  </div>`;
}

function valuePillarsHtml(): string {
  const pillars = [
    {
      title: "Non-custodial escrow",
      body: "Multisig addresses anyone can verify. No admin can freeze or redirect funds.",
      href: "#/about#beliefs",
    },
    {
      title: "Uncensorable proposals",
      body: "The canonical record lives in git. Listed or not, history stays public.",
      href: "#/about#beliefs",
    },
    {
      title: "Protocol over platform",
      body: "Parameters and keyholders are published. Changes require notice, not a config toggle.",
      href: "#/about#parameters",
    },
  ];
  return `<div class="home-pillars">${pillars
    .map(
      (p) => `<a class="home-pillar" href="${p.href}">
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.body)}</p>
        <span class="home-pillar-link">Learn more →</span>
      </a>`,
    )
    .join("")}</div>`;
}

function progressHtml(p: Proposal, floor: number): string {
  const bal = p.balance_sats ?? 0;
  const pct = Math.min(100, Math.round((bal / floor) * 100));
  const claimable = bal >= floor;
  return `<div class="proposal-card-progress">
    <div class="proposal-card-progress-top">
      <span class="proposal-card-progress-label">${claimable ? "Claimable" : `${pct}% to floor`}</span>
      <span class="proposal-card-progress-goal sats">${formatSats(bal)}</span>
    </div>
    <div class="progress"><span style="width:${pct}%"></span></div>
  </div>`;
}

function proposalCardHtml(p: Proposal, floor: number): string {
  const bal = p.balance_sats ?? 0;
  const status = String(p.status);
  return `
    <a class="proposal-card" href="${proposalHref(p.path)}">
      <div class="proposal-card-top">
        <div class="proposal-card-main">
          <span class="pill pill-status ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
          <h3>${escapeHtml(p.title)}</h3>
        </div>
        <div class="proposal-card-funding">
          <span class="balance sats">${formatSats(bal)}</span>
          <span class="proposal-card-target">floor ${formatSats(floor)}</span>
        </div>
      </div>
      ${progressHtml(p, floor)}
    </a>`;
}

async function enrichBalances(proposals: Proposal[]): Promise<Proposal[]> {
  return Promise.all(
    proposals.map(async (p) => {
      if (!p.escrow_address) return p;
      try {
        const balance_sats = await addressBalanceSats(p.escrow_address);
        return { ...p, balance_sats };
      } catch {
        return p;
      }
    }),
  );
}

export async function renderHome(shell: HomeShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="home-hero wrap-wide">
      <div class="home-hero-grid">
        <div class="home-hero-copy">
          ${networkBadgeHtml()}
          <h1 class="hero-tagline">Bitcoin bounties, on-chain and public.</h1>
          <p class="hero-sub">Fund research and development. Escrow lives on Bitcoin. Proposals live in git.</p>
          <div class="cta-row">
            <a class="btn" href="#/propose">Propose a bounty</a>
            <a class="btn ghost" href="#/about">How it works</a>
          </div>
          <p class="hero-follow">${pleblySocialAccountsHtml()}</p>
        </div>
        ${homeStatsHtml()}
      </div>
    </section>

    <section class="wrap-wide home-pillars-section">
      ${valuePillarsHtml()}
    </section>

    <section class="wrap-wide bounties">
      <div class="bounties-head">
        <div>
          <h2>Open bounties</h2>
          <p class="bounties-sub">Live escrow balances from the mempool</p>
        </div>
        <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">View repo →</a>
      </div>
      <div id="list" class="loading">Loading…</div>
    </section>
  `);

  const listEl = app.querySelector("#list")!;
  try {
    let proposals = await listListedProposals();
    proposals = await enrichBalances(proposals);
    if (proposals.length === 0) {
      listEl.className = "empty-state";
      listEl.innerHTML = `<div class="empty-state-inner">
        <p class="empty-state-title">No open bounties yet</p>
        <p class="empty-state-body">Be the first to propose funded work in the open repo.</p>
        <a class="btn" href="#/propose">Propose a bounty</a>
      </div>`;
      return;
    }
    listEl.className = "proposal-list";
    listEl.innerHTML = proposals.map((p) => proposalCardHtml(p, CLAIM_FLOOR_SATS)).join("");
  } catch (e) {
    listEl.className = "error";
    listEl.textContent = `Could not load proposals: ${(e as Error).message}`;
  }
}
