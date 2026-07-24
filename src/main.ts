import "./style.css";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import { renderAbout } from "./about-page";
import { WORKERS_API } from "./config";
import { renderHome } from "./home-page";
import {
  consumeSessionFromHash,
  currentReturnPath,
  fetchCurrentUser,
  githubLoginUrl,
  logout,
  accountNavLabel,
  type AuthUser,
} from "./auth";
import { renderProposalPage } from "./proposal-page";
import { renderPropose } from "./propose-page";
import { renderAccount, renderPublicProfile } from "./profile-pages";
import { pleblySocialAccountsHtml, pleblySocialLinksHtml } from "./icons";
import type { Route } from "./types";
import { escapeHtml, parseRoute, proposalHref } from "./util";

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentUser: AuthUser | null = null;

function route(): Route {
  return parseRoute(location.hash);
}

function authNavHtml(): string {
  if (!WORKERS_API) return "";
  if (currentUser) {
    return `<span class="nav-divider" aria-hidden="true"></span>
      <a href="#/account" class="${route().name === "account" ? "active" : ""}">${escapeHtml(accountNavLabel(currentUser))}</a>
      <button type="button" class="link-btn" id="logout-btn">Log out</button>`;
  }
  return `<span class="nav-divider" aria-hidden="true"></span>
    <a href="${escapeHtml(githubLoginUrl(currentReturnPath()))}">Log in with GitHub</a>`;
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
          <a href="#/" class="${active("home")}">Projects</a>
          <a href="#/propose" class="${active("propose")}">Start a project</a>
          <a href="#/about" class="${active("about")}">About</a>
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
    location.replace("#/account?tab=watching");
    return;
  }
  if (r.name === "account") {
    const tabParam = new URLSearchParams(
      location.hash.includes("?") ? location.hash.slice(location.hash.indexOf("?")) : "",
    ).get("tab");
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
    renderAbout(shell);
    bindAuthHandlers();
    return;
  }
  if (r.name === "params") {
    location.replace("#/about");
    return;
  }
  if (r.name === "proposal") {
    const hash = location.hash;
    const q = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
    const canonical = proposalHref(r.id);
    const current = hash.split("?")[0];
    if (current !== canonical) {
      location.replace(`${canonical}${q}`);
      return;
    }
    await renderProposalPage(r.id, shell, currentUser);
    bindAuthHandlers();
    return;
  }
  await renderHome(shell);
  bindAuthHandlers();
}

window.addEventListener("hashchange", () => void render());
consumeSessionFromHash();
void render();
