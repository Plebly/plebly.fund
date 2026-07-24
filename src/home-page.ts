import {
  BITCOIN_NETWORK,
  CLAIM_FLOOR_SATS,
  PLATFORM_FEE_PERCENT,
  SUBMISSION_FEE_SATS,
  lightningUiAllowed,
} from "./config";
import { listListedProposals } from "./github";
import { fetchLightningStatus } from "./lightning";
import { addressBalanceSats } from "./mempool";
import { statusClass, statusLabel } from "./proposal-ui";
import type { Proposal } from "./types";
import { escapeHtml, formatSats, proposalHref } from "./util";

export type HomeShell = (inner: string) => string;

type SortKey = "funded" | "newest" | "floor";

function networkBadgeHtml(): string {
  const isSignet = BITCOIN_NETWORK === "signet";
  return `<span class="network-badge ${isSignet ? "network-badge-test" : ""}">${isSignet ? "Signet · testing" : "Mainnet"}</span>`;
}

function excerptFromBody(body: string, max = 140): string {
  const text = body
    .replace(/^#+\s+.+$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Open project with on-chain escrow.";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function landingHeroHtml(): string {
  return `<section class="landing-hero">
    <div class="landing-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide landing-hero-inner">
      ${networkBadgeHtml()}
      <p class="landing-brand">Plebly</p>
      <h1 class="landing-title">Fund open Bitcoin projects.<br />Donate on-chain. Keep the record public.</h1>
      <p class="landing-sub">Browse live projects, send sats to escrow anyone can verify, or start the next idea worth funding — without a custodian in the middle.</p>
      <div class="landing-cta-row">
        <a class="btn landing-btn" href="#projects">Donate to a project</a>
        <a class="btn ghost landing-btn" href="#/propose">Start a project</a>
      </div>
      <p class="landing-hero-meta">
        <span>${formatSats(CLAIM_FLOOR_SATS)} claim floor</span>
        <span aria-hidden="true">·</span>
        <span>${PLATFORM_FEE_PERCENT}% on success</span>
        <span aria-hidden="true">·</span>
        <span>${formatSats(SUBMISSION_FEE_SATS)} to propose</span>
      </p>
    </div>
  </section>`;
}

function audiencePathsHtml(): string {
  const paths = [
    {
      kicker: "For donors",
      title: "Fund a project",
      body: "Pick a project, copy the escrow address or open your wallet — no account needed. Balances update from the mempool.",
      href: "#projects",
      cta: "Browse projects",
    },
    {
      kicker: "For builders",
      title: "Claim funded work",
      body: "When escrow hits the claim floor, builders can claim, deliver, and get paid through public review — not an admin button.",
      href: "#projects",
      cta: "See open projects",
    },
    {
      kicker: "For creators",
      title: "Start a project",
      body: "Describe the problem and deliverable, pay the submission fee on-chain, and let donors fund the escrow.",
      href: "#/propose",
      cta: "Start a project",
    },
  ];
  return `<section class="wrap-wide landing-paths">
    <div class="landing-section-head">
      <h2>Choose your path</h2>
      <p>Same rails whether you donate, build, or propose — escrow on Bitcoin, proposals in git.</p>
    </div>
    <div class="path-grid">${paths
      .map(
        (p) => `<a class="path-card" href="${p.href}">
        <span class="path-kicker">${escapeHtml(p.kicker)}</span>
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.body)}</p>
        <span class="path-cta">${escapeHtml(p.cta)} →</span>
      </a>`,
      )
      .join("")}</div>
  </section>`;
}

function howItWorksHtml(): string {
  const steps = [
    { n: "01", title: "Propose", body: "Describe the problem, deliverable, and how success is verified." },
    { n: "02", title: "Donate", body: "Anyone sends sats to the project’s public escrow address." },
    { n: "03", title: "Claim", body: "A builder claims once funding clears the claim floor." },
    { n: "04", title: "Complete", body: "Reviewers verify the work; keyholders release escrow on success." },
  ];
  return `<section class="landing-how">
    <div class="wrap-wide">
      <div class="landing-section-head">
        <h2>How it works</h2>
        <p>Four steps. No custody. Full history in the open.</p>
      </div>
      <ol class="how-grid">${steps
        .map(
          (s) => `<li class="how-step">
          <span class="how-n">${s.n}</span>
          <h3>${escapeHtml(s.title)}</h3>
          <p>${escapeHtml(s.body)}</p>
        </li>`,
        )
        .join("")}</ol>
      <p class="landing-how-link"><a href="#/about">Read the full protocol →</a></p>
    </div>
  </section>`;
}

function trustStripHtml(): string {
  const items = [
    { title: "Non-custodial", body: "Multisig escrow you can verify on-chain" },
    { title: "Uncensorable", body: "Canonical proposals live in a public git repo" },
    { title: "Transparent fees", body: "Parameters published and fixed at launch" },
  ];
  return `<section class="wrap-wide landing-trust">
    <div class="trust-grid">${items
      .map(
        (i) => `<div class="trust-item">
        <h3>${escapeHtml(i.title)}</h3>
        <p>${escapeHtml(i.body)}</p>
      </div>`,
      )
      .join("")}</div>
  </section>`;
}

function discoverToolbarHtml(count: number): string {
  return `<div class="discover-toolbar">
    <div class="discover-toolbar-left">
      <h2 id="projects">Open projects</h2>
      <p class="projects-sub"><span id="project-count">${count}</span> live · donate to any escrow below</p>
    </div>
    <div class="discover-controls">
      <label class="discover-search">
        <span class="sr-only">Search projects</span>
        <input id="project-search" type="search" placeholder="Search projects…" autocomplete="off" />
      </label>
      <label class="discover-sort">
        <span class="sr-only">Sort</span>
        <select id="project-sort">
          <option value="funded">Most funded</option>
          <option value="newest">Newest</option>
          <option value="floor">Closest to floor</option>
        </select>
      </label>
      <a class="discover-repo" href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">Repo →</a>
    </div>
  </div>`;
}

function progressHtml(p: Proposal, floor: number): string {
  const bal = p.balance_sats ?? 0;
  const pct = Math.min(100, Math.round((bal / floor) * 100));
  const claimable = bal >= floor;
  return `<div class="project-card-meter">
    <div class="project-card-meter-top">
      <span class="${claimable ? "claimable" : ""}">${claimable ? "Claimable" : `${pct}% to claim floor`}</span>
      <span class="sats">${formatSats(bal)} / ${formatSats(floor)}</span>
    </div>
    <div class="progress"><span style="width:${pct}%"></span></div>
  </div>`;
}

function proposalCardHtml(
  p: Proposal,
  floor: number,
  lightningEnabled: boolean,
): string {
  const status = String(p.status);
  const proposer =
    p.proposer?.username || p.proposer?.github
      ? `<span class="project-card-by">by ${escapeHtml(p.proposer.username || p.proposer.github || "")}</span>`
      : "";
  const href = `${proposalHref(p.path)}?donate`;
  const lnBadge =
    lightningEnabled && p.escrow_address
      ? `<span class="project-card-ln" title="Lightning settles into on-chain escrow">Lightning</span>`
      : "";
  return `
    <article class="project-card">
      <a class="project-card-main" href="${proposalHref(p.path)}">
        <div class="project-card-head">
          <span class="pill pill-status ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
          ${lnBadge}
          ${proposer}
        </div>
        <h3>${escapeHtml(p.title)}</h3>
        <p class="project-card-excerpt">${escapeHtml(excerptFromBody(p.body))}</p>
        ${progressHtml(p, floor)}
      </a>
      <div class="project-card-actions">
        <a class="btn project-donate-btn" href="${href}">Donate</a>
        <a class="project-card-link" href="${proposalHref(p.path)}">Details →</a>
      </div>
    </article>`;
}

function bottomCtaHtml(): string {
  return `<section class="landing-bottom-cta">
    <div class="wrap-wide landing-bottom-inner">
      <h2>Have a project worth funding?</h2>
      <p>Write a clear deliverable, pay the on-chain submission fee, and list it for donors to support.</p>
      <div class="landing-cta-row">
        <a class="btn" href="#/propose">Start a project</a>
        <a class="btn ghost" href="#/about">About Plebly</a>
      </div>
    </div>
  </section>`;
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

function sortProposals(proposals: Proposal[], key: SortKey, floor: number): Proposal[] {
  const list = [...proposals];
  if (key === "funded") {
    list.sort((a, b) => (b.balance_sats ?? 0) - (a.balance_sats ?? 0));
  } else if (key === "newest") {
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  } else {
    list.sort(
      (a, b) =>
        Math.max(0, floor - (a.balance_sats ?? 0)) -
        Math.max(0, floor - (b.balance_sats ?? 0)),
    );
  }
  return list;
}

function bindDiscover(
  root: ParentNode,
  proposals: Proposal[],
  floor: number,
  lightningEnabled: boolean,
): void {
  const listEl = root.querySelector("#list")!;
  const searchEl = root.querySelector<HTMLInputElement>("#project-search");
  const sortEl = root.querySelector<HTMLSelectElement>("#project-sort");
  const countEl = root.querySelector("#project-count");

  const renderList = () => {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const sort = (sortEl?.value || "funded") as SortKey;
    let filtered = proposals;
    if (q) {
      filtered = proposals.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          String(p.status).toLowerCase().includes(q),
      );
    }
    filtered = sortProposals(filtered, sort, floor);
    if (countEl) countEl.textContent = String(filtered.length);
    if (filtered.length === 0) {
      listEl.className = "empty-state";
      listEl.innerHTML = `<div class="empty-state-inner">
        <p class="empty-state-title">No matching projects</p>
        <p class="empty-state-body">Try another search, or start something new.</p>
        <a class="btn" href="#/propose">Start a project</a>
      </div>`;
      return;
    }
    listEl.className = "project-grid";
    listEl.innerHTML = filtered
      .map((p) => proposalCardHtml(p, floor, lightningEnabled))
      .join("");
  };

  searchEl?.addEventListener("input", renderList);
  sortEl?.addEventListener("change", renderList);
  renderList();
}

export async function renderHome(shell: HomeShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    ${landingHeroHtml()}
    ${audiencePathsHtml()}
    <section class="wrap-wide landing-discover">
      ${discoverToolbarHtml(0)}
      <div id="list" class="loading">Loading open projects…</div>
    </section>
    ${howItWorksHtml()}
    ${trustStripHtml()}
    ${bottomCtaHtml()}
  `);

  const listEl = app.querySelector("#list")!;
  try {
    let proposals = await listListedProposals();
    const [withBalances, lnStatus] = await Promise.all([
      enrichBalances(proposals),
      lightningUiAllowed()
        ? fetchLightningStatus()
        : Promise.resolve({ enabled: false }),
    ]);
    proposals = withBalances;
    const lightningEnabled = Boolean(lnStatus.enabled);
    if (proposals.length === 0) {
      listEl.className = "empty-state";
      listEl.innerHTML = `<div class="empty-state-inner">
        <p class="empty-state-title">No open projects yet</p>
        <p class="empty-state-body">Be the first to list funded work in the open repo.</p>
        <a class="btn" href="#/propose">Start a project</a>
      </div>`;
      return;
    }
    bindDiscover(app, proposals, CLAIM_FLOOR_SATS, lightningEnabled);
  } catch (e) {
    listEl.className = "error";
    listEl.textContent = `Could not load projects: ${(e as Error).message}`;
  }
}
