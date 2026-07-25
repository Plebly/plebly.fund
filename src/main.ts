import "./style.css";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import { renderAbout } from "./about-page";
import { WORKERS_API } from "./config";
import { renderGovernance } from "./governance-page";
import { renderHome } from "./home-page";
import {
  consumeSessionFromHash,
  fetchCurrentUser,
  loginMenuHtml,
  logout,
  accountNavLabel,
  currentReturnPath,
  type AuthUser,
} from "./auth";
import { renderProposalPage } from "./proposal-page";
import { renderPropose } from "./propose-page";
import { renderAccount, renderPublicProfile } from "./profile-pages";
import { pleblySocialAccountsHtml, pleblySocialLinksHtml } from "./icons";
import {
  applySeo,
  bindSpaNavigation,
  href,
  migrateHashRoute,
  navigate,
  parseLocation,
  proposalHref,
  seoForRoute,
} from "./router";
import type { Route } from "./types";
import { escapeHtml } from "./util";

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentUser: AuthUser | null = null;

function route(): Route {
  return parseLocation();
}

function authNavHtml(): string {
  if (!WORKERS_API) return "";
  if (currentUser) {
    return `<span class="nav-divider" aria-hidden="true"></span>
      <a href="${href("/account")}" class="${route().name === "account" ? "active" : ""}">${escapeHtml(accountNavLabel(currentUser))}</a>
      <button type="button" class="link-btn" id="logout-btn">Log out</button>`;
  }
  return `<span class="nav-divider" aria-hidden="true"></span>
    ${loginMenuHtml(currentReturnPath())}`;
}

function siteFooterHtml(): string {
  return `<footer class="site-footer">
    <div class="wrap-wide footer-inner">
      <div class="footer-brand">
        <a class="footer-brand-name" href="${href("/")}">Plebly</a>
        <p class="footer-tagline">Non-custodial Bitcoin bounties.<br />Protocol over platform.</p>
      </div>
      <nav class="footer-nav" aria-label="Site">
        <div class="footer-col">
          <h2 class="footer-col-title">Explore</h2>
          <a href="${href("/")}">Projects</a>
          <a href="${href("/propose")}">Start a project</a>
          <a href="${href("/about")}">About</a>
          <a href="${href("/reviewers")}">Reviewers</a>
        </div>
        <div class="footer-col">
          <h2 class="footer-col-title">Source</h2>
          <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">Proposals</a>
          <a href="https://github.com/Plebly/proposals/blob/main/REVIEWERS.md" target="_blank" rel="noreferrer">Reviewer rules</a>
          <a href="https://github.com/Plebly/proposals/blob/main/PARAMETERS.md" target="_blank" rel="noreferrer">Parameters</a>
        </div>
      </nav>
      <div class="footer-aside">
        <p class="footer-aside-label">Follow</p>
        ${pleblySocialAccountsHtml()}
      </div>
    </div>
  </footer>`;
}

function shell(inner: string): string {
  const r = route();
  const active = (name: string) => (r.name === name ? "active" : "");
  return `
    <header class="wrap-wide site-header">
      <a class="brand" href="${href("/")}">
        <img src="${import.meta.env.BASE_URL}logo.jpeg" alt="" width="28" height="28" />
        <span>Plebly</span>
      </a>
      <div class="header-end">
        <nav class="nav">
          <a href="${href("/")}" class="${active("home")}">Projects</a>
          <a href="${href("/propose")}" class="${active("propose")}">Start a project</a>
          <a href="${href("/about")}" class="${active("about")}">About</a>
          ${authNavHtml()}
        </nav>
        ${pleblySocialLinksHtml()}
      </div>
    </header>
    <main>${inner}</main>
    ${siteFooterHtml()}
  `;
}

function bindAuthHandlers() {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await logout();
    currentUser = null;
    void render();
  });
}

function scrollToHashTarget(): void {
  const raw = location.hash;
  if (!raw || raw === "#" || raw.includes("plebly_auth=")) return;
  const id = decodeURIComponent(raw.slice(1).split("&")[0] || "");
  if (!id) return;
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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

  if (r.name === "work") {
    navigate("/account?tab=watching", { replace: true });
    return;
  }
  if (r.name === "account") {
    applySeo(seoForRoute(r));
    const tabParam = new URLSearchParams(location.search).get("tab");
    const initialTab = (
      tabParam === "watching" ||
      tabParam === "claims" ||
      tabParam === "proposals" ||
      tabParam === "profile"
        ? tabParam
        : undefined
    ) as "profile" | "watching" | "claims" | "proposals" | undefined;
    await renderAccount(ctx, initialTab);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "propose") {
    applySeo(seoForRoute(r));
    await renderPropose(ctx);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "profile") {
    applySeo(seoForRoute(r));
    await renderPublicProfile(ctx, r.username);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "about") {
    applySeo(seoForRoute(r));
    renderAbout(shell);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "reviewers") {
    applySeo(seoForRoute(r));
    await renderGovernance(shell, currentUser);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "params") {
    navigate("/about", { replace: true });
    return;
  }
  if (r.name === "proposal") {
    const canonicalPath = new URL(proposalHref(r.id), location.origin);
    if (location.pathname !== canonicalPath.pathname) {
      navigate(`${canonicalPath.pathname}${location.search}`, { replace: true });
      return;
    }
    await renderProposalPage(r.id, shell, currentUser);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  applySeo(seoForRoute({ name: "home" }));
  await renderHome(shell);
  bindAuthHandlers();
  scrollToHashTarget();
}

migrateHashRoute();
consumeSessionFromHash();
bindSpaNavigation();
window.addEventListener("popstate", () => void render());
void render();
