import "./style.css";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import { renderAbout } from "./about-page";
import { renderDeclined } from "./declined-page";
import { WORKERS_API } from "./config";
import { renderGovernance } from "./governance-page";
import { renderHome } from "./home-page";
import {
  consumeSessionFromHash,
  fetchCurrentUser,
  fetchUnreadNotificationCount,
  bindLoginHandlers,
  loginMenuHtml,
  logout,
  accountNavLabel,
  currentReturnPath,
  bindNotificationDropdown,
  notificationNavBadgeHtml,
  setUnreadNotificationCount,
  type AuthUser,
} from "./auth";
import { renderProposalPage } from "./proposal-page";
import { renderPropose } from "./propose-page";
import { renderAccount, renderPublicProfile } from "./profile-pages";
import { renderStats } from "./stats-page";
import { renderWanted } from "./wanted-page";
import { syncStoredCreditPreferencesFromProfile } from "./funder-credit";
import { pleblySocialAccountsHtml, pleblySocialLinksHtml } from "./icons";
import { findListedProposalById } from "./github";
import {
  applySeo,
  bindSpaNavigation,
  href,
  migrateHashRoute,
  navigate,
  parseLocation,
  seoForRoute,
} from "./router";
import type { Route } from "./types";
import { escapeHtml } from "./util";

/** Styles land with this module — first paint used index.html boot chrome. */
document.documentElement.classList.add("app-ready");

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentUser: AuthUser | null = null;
let unreadNotifications = 0;

function route(): Route {
  return parseLocation();
}

function authNavHtml(): string {
  if (!WORKERS_API) return "";
  if (currentUser) {
    const label = accountNavLabel(currentUser);
    const badge = notificationNavBadgeHtml(unreadNotifications);
    return `<span class="nav-divider" aria-hidden="true"></span>
      <span class="nav-account-wrap" data-nav-account-wrap>
        <a href="${href("/account")}" data-nav-account class="nav-account ${route().name === "account" ? "active" : ""}">${escapeHtml(label)}</a>
        ${badge}
      </span>
      <button type="button" class="link-btn" id="logout-btn">Log out</button>`;
  }
  return `<span class="nav-divider" aria-hidden="true"></span>
    ${loginMenuHtml(currentReturnPath())}`;
}

function siteFooterHtml(routeName: string): string {
  const fa = (name: string) => (routeName === name ? ' class="active"' : "");
  return `<footer class="site-footer">
    <div class="wrap-wide footer-inner">
      <div class="footer-brand">
        <a class="footer-brand-name" href="${href("/")}">Plebly</a>
        <p class="footer-tagline">Non-custodial Bitcoin bounties.<br />Protocol over platform.</p>
      </div>
      <nav class="footer-nav" aria-label="Site">
        <div class="footer-col">
          <h2 class="footer-col-title">Explore</h2>
          <a href="${href("/")}"${fa("home")}>Projects</a>
          <a href="${href("/wanted")}"${fa("wanted")}>Most wanted</a>
          <a href="${href("/propose")}"${fa("propose")}>Start a project</a>
          <a href="${href("/about")}"${fa("about")}>About</a>
          <a href="${href("/stats")}"${fa("stats")}>Stats</a>
          <a href="${href("/declined")}"${fa("declined")}>Declined</a>
          <a href="${href("/reviewers")}"${fa("reviewers")}>Reviewers</a>
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
  const current = (name: string) =>
    r.name === name ? ' aria-current="page"' : "";
  return `
    <a class="skip-link" href="#main-content">Skip to content</a>
    <header class="wrap-wide site-header">
      <a class="brand" href="${href("/")}">
        <img src="${import.meta.env.BASE_URL}logo.jpeg" alt="Plebly" width="28" height="28" />
        <span>Plebly</span>
      </a>
      <div class="header-end">
        <nav class="nav" aria-label="Primary">
          <a href="${href("/")}" class="${active("home")}"${current("home")}>Projects</a>
          <a href="${href("/propose")}" class="${active("propose")}"${current("propose")}>Start a project</a>
          <a href="${href("/about")}" class="${active("about")}"${current("about")}>About</a>
          ${authNavHtml()}
        </nav>
        ${pleblySocialLinksHtml()}
      </div>
    </header>
    <main id="main-content">${inner}</main>
    ${siteFooterHtml(r.name)}
  `;
}

function bindAuthHandlers() {
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await logout();
    currentUser = null;
    void render();
  });
  bindLoginHandlers(() => void render());
  bindNotificationDropdown();
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
  if (currentUser?.funder_credit) {
    syncStoredCreditPreferencesFromProfile(currentUser.funder_credit);
  }
  unreadNotifications = currentUser
    ? await fetchUnreadNotificationCount().catch(() => 0)
    : 0;
  const r = route();
  const ctx = {
    user: currentUser,
    routeName: r.name,
    shell,
    rerender: () => void render(),
    setUnreadNotifications: (count: number) => {
      unreadNotifications = setUnreadNotificationCount(count);
    },
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
      tabParam === "notifications" ||
      tabParam === "profile"
        ? tabParam
        : undefined
    ) as
      | "profile"
      | "watching"
      | "claims"
      | "proposals"
      | "notifications"
      | undefined;
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
  if (r.name === "stats") {
    applySeo(seoForRoute(r));
    await renderStats(shell);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "wanted") {
    applySeo(seoForRoute(r));
    await renderWanted(shell);
    bindAuthHandlers();
    scrollToHashTarget();
    return;
  }
  if (r.name === "declined") {
    applySeo(seoForRoute(r));
    await renderDeclined(shell);
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
    // Stable /p/{id}: resolve via Worker idmap (O(1)). Legacy /proposal/... uses path directly.
    const proposal = r.stable ? await findListedProposalById(r.id) : null;
    const path = proposal?.path || (!r.stable ? r.id : "");
    if (!path) {
      applySeo(seoForRoute({ name: "home" }));
      await renderHome(shell);
      bindAuthHandlers();
      return;
    }
    await renderProposalPage(
      path,
      shell,
      currentUser,
      () => {
        void render();
      },
      proposal,
    );
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
