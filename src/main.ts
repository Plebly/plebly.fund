import "./style.css";
import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import { fetchCurrentUser, githubLoginUrl, logout, userLabel } from "./auth";
import { listListedProposals, fetchParametersMarkdown } from "./github";
import { addressBalanceSats } from "./mempool";
import type { Proposal } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;

let currentUser: Awaited<ReturnType<typeof fetchCurrentUser>> = null;

function route(): { name: "home" | "proposal" | "params"; id?: string } {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash || hash === "home") return { name: "home" };
  if (hash === "parameters") return { name: "params" };
  if (hash.startsWith("proposal/")) {
    return { name: "proposal", id: decodeURIComponent(hash.slice("proposal/".length)) };
  }
  return { name: "home" };
}

function authNavHtml(): string {
  if (!WORKERS_API) return "";
  if (currentUser) {
    return `<span class="auth-user">${escapeHtml(userLabel(currentUser))}</span>
      <button type="button" class="link-btn" id="logout-btn">Log out</button>`;
  }
  return `<a href="${escapeHtml(githubLoginUrl())}">Log in with GitHub</a>`;
}

function shell(inner: string): string {
  return `
    <header class="wrap site-header">
      <a class="brand" href="#/">
        <img src="${import.meta.env.BASE_URL}logo.jpeg" alt="" width="36" height="36" />
        <span>Plebly</span>
      </a>
      <nav class="nav">
        <a href="#/" class="${route().name === "home" ? "active" : ""}">Bounties</a>
        <a href="#/parameters" class="${route().name === "params" ? "active" : ""}">Parameters</a>
        <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">Proposals repo</a>
        ${authNavHtml()}
      </nav>
    </header>
    <main>${inner}</main>
    <footer class="wrap site-footer">
      <span>Non-custodial Bitcoin bounties. Protocol over platform.</span>
      <span><a href="https://github.com/Plebly">github.com/Plebly</a></span>
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

function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

function progressHtml(p: Proposal): string {
  const bal = p.balance_sats ?? 0;
  const pct = Math.min(100, Math.round((bal / CLAIM_FLOOR_SATS) * 100));
  const target =
    p.target_sats != null
      ? ` · target ${formatSats(p.target_sats)}`
      : "";
  return `
    <div class="progress">
      <div class="label">${formatSats(bal)} / ${formatSats(CLAIM_FLOOR_SATS)} floor${target}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
    </div>
  `;
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
      <h1 class="hero-brand">Plebly</h1>
      <p>Public bounties for Bitcoin development and research. Escrow is on-chain multisig. The proposal record is a public git repository anyone can fork.</p>
      <div class="cta-row">
        <a class="btn" href="https://github.com/Plebly/proposals/blob/main/template/proposal.md" target="_blank" rel="noreferrer">Submit a proposal</a>
        <a class="btn ghost" href="#/parameters">Fee parameters</a>
      </div>
    </section>
    <section class="wrap section">
      <h2>Open bounties</h2>
      <p class="lede">Listed from the canonical proposals repository. Balances from the Bitcoin chain.</p>
      <div id="list" class="loading">Loading proposals…</div>
    </section>
  `);

  const listEl = app.querySelector("#list")!;
  try {
    let proposals = await listListedProposals();
    proposals = await enrichBalances(proposals);
    if (proposals.length === 0) {
      listEl.className = "empty";
      listEl.innerHTML =
        "No listed proposals yet. Open a pull request on <a href=\"https://github.com/Plebly/proposals\">Plebly/proposals</a>.";
      return;
    }
    listEl.className = "proposal-list";
    listEl.innerHTML = proposals
      .map(
        (p) => `
      <article class="proposal-row">
        <div>
          <h3><a href="#/proposal/${encodeURIComponent(p.path)}">${escapeHtml(p.title)}</a></h3>
          <div class="meta">
            <span class="pill">${escapeHtml(String(p.status))}</span>
            <span>${escapeHtml(p.id || "")}</span>
          </div>
        </div>
        ${progressHtml(p)}
      </article>`,
      )
      .join("");
  } catch (e) {
    listEl.className = "error";
    listEl.textContent = `Could not load proposals: ${(e as Error).message}`;
  }
}

async function renderProposal(path: string) {
  app.innerHTML = shell(`<section class="wrap detail"><p class="loading">Loading…</p></section>`);
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/Plebly/proposals/main/${path}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const proposals = await listListedProposals();
    const match =
      proposals.find((p) => p.path === path) ||
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
    let balance: number | undefined;
    if (match.escrow_address) {
      try {
        balance = await addressBalanceSats(match.escrow_address);
      } catch {
        /* ignore */
      }
    }
    app.innerHTML = shell(`
      <section class="wrap detail">
        <a href="#/">← Bounties</a>
        <h1>${escapeHtml(match.title)}</h1>
        <div class="meta">
          <span class="pill">${escapeHtml(String(match.status))}</span>
          <span>${escapeHtml(match.id || "")}</span>
        </div>
        <div class="panel">
          <div>Claim floor: ${formatSats(CLAIM_FLOOR_SATS)}</div>
          <div>Balance: ${balance != null ? formatSats(balance) : "—"}</div>
          <div>Escrow: <span class="mono">${escapeHtml(match.escrow_address || "not allocated")}</span></div>
        </div>
        <div class="prose">${escapeHtml(match.body)}</div>
      </section>
    `);
  } catch (e) {
    app.innerHTML = shell(
      `<section class="wrap detail"><p class="error">${escapeHtml((e as Error).message)}</p></section>`,
    );
  }
}

async function renderParams() {
  app.innerHTML = shell(
    `<section class="wrap detail"><h1>Parameters</h1><p class="loading">Loading…</p></section>`,
  );
  const md = await fetchParametersMarkdown();
  app.innerHTML = shell(`
    <section class="wrap detail">
      <h1>Parameters</h1>
      <div class="prose">${escapeHtml(md || "PARAMETERS.md not available yet.")}</div>
    </section>
  `);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function render() {
  currentUser = await fetchCurrentUser();
  const r = route();
  if (r.name === "params") {
    await renderParams();
    bindAuthHandlers();
    return;
  }
  if (r.name === "proposal" && r.id) {
    await renderProposal(r.id);
    bindAuthHandlers();
    return;
  }
  await renderHome();
  bindAuthHandlers();
}

window.addEventListener("hashchange", () => void render());
void render();
