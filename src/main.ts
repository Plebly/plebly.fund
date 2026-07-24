import "./style.css";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import {
  consumeSessionFromHash,
  currentReturnPath,
  fetchCurrentUser,
  githubLoginUrl,
  logout,
  profilePath,
  type AuthUser,
} from "./auth";
import { ABOUT_HTML } from "./generated/about-html";
import { listListedProposals } from "./github";
import { addressBalanceSats } from "./mempool";
import { renderProposalPage } from "./proposal-page";
import { renderPropose } from "./propose-page";
import { renderAccount, renderPublicProfile } from "./profile-pages";
import { pleblySocialAccountsHtml, pleblySocialLinksHtml } from "./icons";
import type { Proposal, Route } from "./types";
import { escapeHtml, formatSats, parseRoute, proposalHref } from "./util";

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentUser: AuthUser | null = null;

function route(): Route {
  return parseRoute(location.hash);
}

function authNavHtml(): string {
  if (!WORKERS_API) return "";
  if (currentUser) {
    const profileLink = currentUser.username
      ? `<a href="${profilePath(currentUser.username)}">${escapeHtml(currentUser.username)}</a>`
      : "";
    return `<span class="nav-divider" aria-hidden="true"></span>
      ${profileLink}
      <a href="#/account">Account</a>
      <button type="button" class="link-btn" id="logout-btn">Log out</button>`;
  }
  return `<span class="nav-divider" aria-hidden="true"></span>
    <a href="${escapeHtml(githubLoginUrl(currentReturnPath()))}">Log in</a>`;
}

function shell(inner: string): string {
  const r = route();
  const active = (name: string) => (r.name === name ? "active" : "");
  return `
    <header class="wrap-wide site-header">
      <a class="brand" href="#/">
        <img src="${import.meta.env.BASE_URL}logo.jpeg" alt="" width="28" height="28" />
        <span>Plebly</span>
      </a>
      <div class="header-end">
        <nav class="nav">
          <a href="#/" class="${active("home")}">Bounties</a>
          <a href="#/propose" class="${active("propose")}">Propose</a>
          <a href="#/about" class="${active("about")}">About us</a>
          ${authNavHtml()}
        </nav>
        ${pleblySocialLinksHtml()}
      </div>
    </header>
    <main>${inner}</main>
    <footer class="wrap-wide site-footer">
      <span>Non-custodial · Protocol over platform</span>
      <span class="footer-links">
        <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">Proposals</a>
        ${pleblySocialAccountsHtml()}
      </span>
    </footer>
  `;
}

function bindAuthHandlers() {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await logout();
    currentUser = null;
    void render();
  });
}

function progressHtml(p: Proposal): string {
  const bal = p.balance_sats ?? 0;
  const pct = Math.min(100, Math.round((bal / CLAIM_FLOOR_SATS) * 100));
  return `<div class="progress" title="${formatSats(bal)} funded"><span style="width:${pct}%"></span></div>`;
}

function proposalCardHtml(p: Proposal): string {
  const bal = p.balance_sats ?? 0;
  return `
    <a class="proposal-card" href="${proposalHref(p.path)}">
      <div class="proposal-card-top">
        <h3>${escapeHtml(p.title)}</h3>
        <span class="balance sats">${formatSats(bal)}</span>
      </div>
      ${progressHtml(p)}
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

async function renderHome() {
  app.innerHTML = shell(`
    <section class="wrap hero">
      <h1 class="hero-tagline">Bitcoin bounties, on-chain and public.</h1>
      <p class="hero-sub">Fund research and development. Escrow lives on Bitcoin. Proposals live in git.</p>
      <div class="cta-row">
        <a class="btn" href="#/propose">Propose a bounty</a>
      </div>
      <p class="hero-follow">${pleblySocialAccountsHtml()}</p>
    </section>
    <section class="wrap-wide bounties">
      <div class="bounties-head">
        <h2>Open bounties</h2>
        <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">View repo</a>
      </div>
      <div id="list" class="loading">Loading…</div>
    </section>
  `);

  const listEl = app.querySelector("#list")!;
  try {
    let proposals = await listListedProposals();
    proposals = await enrichBalances(proposals);
    if (proposals.length === 0) {
      listEl.className = "empty";
      listEl.innerHTML = `No bounties yet. <a href="#/propose">Propose the first</a>.`;
      return;
    }
    listEl.className = "proposal-list";
    listEl.innerHTML = proposals.map(proposalCardHtml).join("");
  } catch (e) {
    listEl.className = "error";
    listEl.textContent = `Could not load proposals: ${(e as Error).message}`;
  }
}

async function renderAbout() {
  app.innerHTML = shell(`
    <section class="wrap detail about-page">
      <h1>About us</h1>
      <div class="prose-rich">${ABOUT_HTML}</div>
    </section>
  `);
}

async function render() {
  currentUser = await fetchCurrentUser();
  const r = route();
  const ctx = {
    user: currentUser,
    routeName: r.name,
    shell,
    rerender: () => void render(),
  };

  if (r.name === "account") {
    await renderAccount(ctx);
    bindAuthHandlers();
    return;
  }
  if (r.name === "propose") {
    await renderPropose(ctx);
    bindAuthHandlers();
    return;
  }
  if (r.name === "profile") {
    await renderPublicProfile(ctx, r.username);
    bindAuthHandlers();
    return;
  }
  if (r.name === "about") {
    await renderAbout();
    bindAuthHandlers();
    return;
  }
  if (r.name === "params") {
    location.replace("#/about");
    return;
  }
  if (r.name === "proposal") {
    const canonical = proposalHref(r.id);
    const current = location.hash.split("?")[0];
    if (current !== canonical) {
      location.replace(canonical);
      return;
    }
    await renderProposalPage(r.id, shell);
    bindAuthHandlers();
    return;
  }
  await renderHome();
  bindAuthHandlers();
}

window.addEventListener("hashchange", () => void render());
consumeSessionFromHash();
void render();
