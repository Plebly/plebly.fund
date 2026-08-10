import { currentReturnPath, loginMenuHtml } from "./auth";
import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import { listListedProposals } from "./github";
import { bindCardWatches, proposalCardHtml } from "./home-page";
import { hydrateAvatarSlots } from "./profile-avatars";
import {
  bindDonateModal,
  bindDonatePanel,
  endowmentDonateModalHtml,
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
  goal_sats: number;
  display_updated_at: string;
  funded_proposal_ids: string[];
  lightning_available: boolean;
};

async function fetchEndowment(): Promise<EndowmentPublic> {
  const res = await fetch(`${API()}/endowment`);
  if (!res.ok) throw new Error(`Could not load endowment (${res.status})`);
  return (await res.json()) as EndowmentPublic;
}

function heroSizeHtml(opts: {
  sats: number;
  goal: number;
}): string {
  const goal = opts.goal > 0 ? opts.goal : 0;
  if (goal > 0) {
    const pct = Math.min(100, Math.round((opts.sats / goal) * 1000) / 10);
    return `<div class="endowment-hero-progress" aria-live="polite">
      <div class="endowment-hero-progress-top">
        <span class="endowment-hero-size-value mono">${escapeHtml(formatSats(opts.sats))}</span>
        <span class="endowment-hero-size-meta">of ${escapeHtml(formatSats(goal))}</span>
      </div>
      <div class="endowment-hero-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${opts.sats}" aria-label="Endowment progress">
        <span style="width:${pct}%"></span>
      </div>
    </div>`;
  }
  return `<p class="endowment-hero-size" aria-live="polite">
    <span class="endowment-hero-size-value mono">${escapeHtml(formatSats(opts.sats))}</span>
  </p>`;
}

function heroHtml(opts: {
  open: boolean;
  sats: number;
  goal: number;
}): string {
  const signal = opts.open
    ? heroSizeHtml({ sats: opts.sats, goal: opts.goal })
    : `<p class="endowment-hero-closed">Donations open once the receive address is set.</p>`;

  const cta = opts.open
    ? `<div class="endowment-cta-row">
        <button type="button" class="btn endowment-donate-btn" data-open-donate>Donate</button>
        <a class="endowment-secondary-link" href="#funded">Funded projects</a>
      </div>`
    : "";

  return `<section class="endowment-hero">
    <div class="endowment-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide endowment-hero-inner">
      <h1 class="endowment-brand">Endowment</h1>
      ${signal}
      <p class="endowment-lede">A shared pool for open Bitcoin work. On-chain or Lightning.</p>
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
      <p class="muted">No funded projects yet.</p>
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

function scrollToFundedIfNeeded(): void {
  if (location.hash.replace(/^#/, "") !== "funded") return;
  document.getElementById("funded")?.scrollIntoView({ behavior: "smooth" });
}

function wantsDonateOpen(): boolean {
  return (
    location.hash.replace(/^#/, "") === "donate" ||
    /(?:^|[?&])donate(?:=[^&]*)?(?:&|$)/.test(location.search) ||
    /(?:^|[?&])rail=lightning(?:&|$)/.test(location.search)
  );
}

function wantsLnRail(): boolean {
  return /(?:^|[?&])(?:rail=lightning|donate=ln)(?:&|$)/.test(location.search);
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
    ${heroHtml({ open: false, sats: 0, goal: 0 })}
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
    const open = Boolean(view.configured && view.address);
    const countLabel =
      funded.length === 1 ? "1 project" : `${funded.length} projects`;

    app.innerHTML = shell(`
      ${heroHtml({
        open,
        sats: view.display_balance_sats,
        goal: Math.max(0, Math.floor(Number(view.goal_sats) || 0)),
      })}
      ${bodyHtml(`
        <section class="endowment-funded" id="funded">
          <div class="endowment-funded-head">
            <h2>Funded projects</h2>
            ${
              open
                ? `<p class="muted">${escapeHtml(countLabel)}</p>`
                : `<p class="muted">Set the receive address in <a href="${href("/admin")}?tab=endowment">Admin</a> to open donations.</p>`
            }
          </div>
          ${fundedCardsHtml(funded, Boolean(view.lightning_available))}
        </section>
      `)}
      ${open && view.address ? endowmentDonateModalHtml(view.address) : ""}
    `);

    if (view.address && open) {
      bindDonateModal(app, {
        open: wantsDonateOpen(),
        rail: wantsLnRail() ? "lightning" : undefined,
      });
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
    scrollToFundedIfNeeded();
  } catch (e) {
    const msg = (e as Error).message || "Could not load endowment";
    const looksLikeApiDown = /\b(404|502|503)\b/.test(msg);
    app.innerHTML = shell(`
      ${heroHtml({ open: false, sats: 0, goal: 0 })}
      ${bodyHtml(`
        <p class="error">${escapeHtml(msg)}</p>
        ${
          looksLikeApiDown
            ? `<p class="muted">The Workers API has not published this route yet — try again after deploy.</p>`
            : `<p>${loginMenuHtml(currentReturnPath())}</p>`
        }
      `)}
    `);
  }
}
