import { currentReturnPath, loginMenuHtml } from "./auth";
import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import { listListedProposals } from "./github";
import { bindCardWatches, proposalCardHtml } from "./home-page";
import { hydrateAvatarSlots } from "./profile-avatars";
import {
  bindDonatePanel,
  endowmentDonatePanelHtml,
} from "./proposal-ui";
import { applySeo, href, projectsHref, seoForRoute } from "./router";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type EndowmentShell = (inner: string) => string;

const API = () => WORKERS_API.replace(/\/$/, "");
const ACTIVE = new Set([
  "listed",
  "funding",
  "claimable",
  "claimed",
  "in_review",
]);

type EndowmentPublic = {
  address: string | null;
  configured: boolean;
  display_balance_sats: number;
  display_updated_at: string;
  funded_proposal_ids: string[];
  lightning_available: boolean;
};

async function fetchEndowment(): Promise<EndowmentPublic> {
  const res = await fetch(`${API()}/endowment`);
  if (!res.ok) throw new Error(`Could not load endowment (${res.status})`);
  return (await res.json()) as EndowmentPublic;
}

function heroHtml(opts: {
  open: boolean;
  sats: number;
  updated: string;
}): string {
  const size = opts.open
    ? `<p class="endowment-hero-size" aria-live="polite">
        <span class="endowment-hero-size-label">Endowment size</span>
        <span class="endowment-hero-size-value mono">${escapeHtml(formatSats(opts.sats))}</span>
        <span class="endowment-hero-size-meta">published${
          opts.updated ? ` · ${escapeHtml(opts.updated)}` : ""
        }</span>
      </p>`
    : "";
  const cta = opts.open
    ? `<div class="landing-cta-row">
        <a class="btn landing-btn" href="#donate">Donate</a>
        <a class="btn ghost landing-btn" href="#funded">Funded projects</a>
      </div>`
    : `<p class="endowment-hero-closed muted">Donations open once the endowment address is set.</p>`;

  return `<section class="endowment-hero">
    <div class="endowment-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide endowment-hero-inner">
      <h1 class="landing-brand">Endowment</h1>
      <p class="landing-title">Support open Bitcoin work from one shared pool.</p>
      <p class="landing-sub">Send Bitcoin on-chain or Lightning. Anonymous by default.</p>
      ${size}
      ${cta}
    </div>
  </section>`;
}

function fundedCardsHtml(
  proposals: Proposal[],
  lightningEnabled: boolean,
): string {
  if (!proposals.length) {
    return `<div class="endowment-funded-empty">
      <p class="muted">No endowment-funded projects listed yet.</p>
      <p><a href="${projectsHref()}">Browse open projects →</a></p>
    </div>`;
  }
  return `<div class="project-grid endowment-funded-grid">${proposals
    .map((p) => proposalCardHtml(p, CLAIM_FLOOR_SATS, lightningEnabled, false))
    .join("")}</div>`;
}

function bodyHtml(inner: string): string {
  return `<div class="endowment-body">
    <div class="wrap-wide endowment-body-inner">
      ${inner}
    </div>
  </div>`;
}

function scrollToHashTarget(): void {
  const hash = location.hash.replace(/^#/, "");
  const fromQuery = new URLSearchParams(location.search).has("donate")
    ? "donate"
    : "";
  const id = hash || fromQuery;
  if (!id) return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export async function renderEndowment(shell: EndowmentShell): Promise<void> {
  applySeo(seoForRoute({ name: "endowment" }));
  const app = document.querySelector("#app")!;
  if (!WORKERS_API) {
    app.innerHTML = shell(
      bodyHtml(`<p class="muted">Workers API not configured.</p>`),
    );
    return;
  }

  app.innerHTML = shell(`
    ${heroHtml({ open: false, sats: 0, updated: "" })}
    ${bodyHtml(`<p class="muted">Loading…</p>`)}
  `);

  try {
    const [view, listed] = await Promise.all([
      fetchEndowment(),
      listListedProposals().catch(() => [] as Proposal[]),
    ]);
    const fundedSet = new Set(
      view.funded_proposal_ids.map((id) => id.trim().toLowerCase()),
    );
    const funded = listed.filter(
      (p) =>
        p.id &&
        fundedSet.has(p.id.trim().toLowerCase()) &&
        ACTIVE.has(String(p.status)),
    );
    const updated = view.display_updated_at
      ? view.display_updated_at.slice(0, 10)
      : "";
    const open = Boolean(view.configured && view.address);

    const donateBlock =
      open && view.address
        ? `<section class="endowment-contribute" id="donate-section">
            ${endowmentDonatePanelHtml(view.address)}
          </section>`
        : `<section class="endowment-contribute">
            <div class="endowment-closed-card">
              <p class="endowment-closed-title">Donations are not open yet</p>
              <p class="muted">An admin sets the endowment receive address in <a href="${href("/admin")}?tab=endowment">Admin → Endowment</a>.</p>
            </div>
          </section>`;

    app.innerHTML = shell(`
      ${heroHtml({
        open,
        sats: view.display_balance_sats,
        updated,
      })}
      ${bodyHtml(`
        ${donateBlock}
        <section class="endowment-funded" id="funded">
          <h2>Funded projects</h2>
          ${fundedCardsHtml(funded, Boolean(view.lightning_available))}
        </section>
      `)}
    `);

    if (view.address) {
      await bindDonatePanel(app, {
        address: view.address,
        proposalId: null,
        proposalPath: "/endowment",
        mode: "endowment",
      });
    }
    const fundedRoot = app.querySelector("#funded");
    if (fundedRoot) {
      bindCardWatches(fundedRoot, new Set());
      void hydrateAvatarSlots(fundedRoot);
    }
    scrollToHashTarget();
  } catch (e) {
    const msg = (e as Error).message || "Could not load endowment";
    const looksLikeApiDown = /\b(404|502|503)\b/.test(msg);
    app.innerHTML = shell(`
      ${heroHtml({ open: false, sats: 0, updated: "" })}
      ${bodyHtml(`
        <p class="error">${escapeHtml(msg)}</p>
        ${
          looksLikeApiDown
            ? `<p class="muted">The Workers API has not published this route yet — try again after deploy. Login is not required to view the endowment.</p>`
            : `<p>${loginMenuHtml(currentReturnPath())}</p>`
        }
      `)}
    `);
  }
}
