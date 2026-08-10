import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import { listListedProposals } from "./github";
import { bindCardWatches, proposalCardHtml } from "./home-page";
import { hydrateAvatarSlots } from "./profile-avatars";
import {
  bindDonateModal,
  bindDonatePanel,
  endowmentDonateModalHtml,
  endowmentMeterHtml,
} from "./proposal-ui";
import { applySeo, projectsHref, seoForRoute } from "./router";
import type { Proposal } from "./types";
import { escapeHtml } from "./util";

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
  const body = (await res.json()) as Partial<EndowmentPublic>;
  return {
    address: body.address ?? null,
    configured: Boolean(body.configured),
    display_balance_sats: Math.max(
      0,
      Math.floor(Number(body.display_balance_sats) || 0),
    ),
    goal_sats: Math.max(0, Math.floor(Number(body.goal_sats) || 0)),
    display_updated_at: body.display_updated_at || "",
    funded_proposal_ids: Array.isArray(body.funded_proposal_ids)
      ? body.funded_proposal_ids
      : [],
    lightning_available: Boolean(body.lightning_available),
  };
}

function heroHtml(opts: {
  open: boolean;
  sats: number;
  goal: number;
}): string {
  const signal = opts.open
    ? endowmentMeterHtml(opts.sats, opts.goal, { size: "hero" })
    : "";

  const cta = opts.open
    ? `<div class="endowment-cta-row">
        <button type="button" class="btn endowment-donate-btn" data-open-donate>Donate</button>
        <a class="endowment-secondary-link" href="#funded">Funded projects</a>
      </div>`
    : `<p class="endowment-hero-closed">Donations open soon.</p>`;

  return `<section class="endowment-hero">
    <div class="endowment-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide endowment-hero-inner">
      <h1 class="endowment-brand">Endowment</h1>
      <p class="endowment-lede">A shared Bitcoin pool for open work that moves the ecosystem forward.</p>
      ${signal}
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
      <p class="muted">None yet. <a href="${projectsHref()}">Browse projects</a></p>
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
    app.innerHTML = shell(bodyHtml(`<p class="muted">Coming soon.</p>`));
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
        goal: view.goal_sats,
      })}
      ${bodyHtml(`
        <section class="endowment-funded" id="funded">
          <div class="endowment-funded-head">
            <h2>Funded projects</h2>
            <p class="muted">${escapeHtml(countLabel)}</p>
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
  } catch {
    app.innerHTML = shell(`
      ${heroHtml({ open: false, sats: 0, goal: 0 })}
      ${bodyHtml(`<p class="muted">Could not load endowment right now.</p>`)}
    `);
  }
}
