import { fetchCurrentUser } from "./auth";
import { CLAIM_FLOOR_SATS, mempoolWeb, WORKERS_API } from "./config";
import { ENDOWMENT_BLURB, ENDOWMENT_HOW_STEPS } from "./endowment-copy";
import { listListedProposals } from "./github";
import { bindCardWatches, proposalCardHtml } from "./home-page";
import { hydrateAvatarSlots } from "./profile-avatars";
import {
  bindDonateModal,
  bindDonatePanel,
  endowmentDonateModalHtml,
  endowmentMeterHtml,
} from "./proposal-ui";
import { applySeo, href, proposalHref, projectsHref, seoForRoute } from "./router";
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

type EndowmentContribution = {
  id: string;
  proposal_id: string;
  amount_sats: number;
  granted_at: string;
  note?: string;
  txid?: string;
};

type EndowmentPublic = {
  address: string | null;
  configured: boolean;
  display_balance_sats: number;
  goal_sats: number;
  display_updated_at: string;
  funded_proposal_ids: string[];
  contributions: EndowmentContribution[];
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
    contributions: Array.isArray(body.contributions) ? body.contributions : [],
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
        <a class="endowment-secondary-link" href="#contributions">Contributions</a>
      </div>`
    : `<p class="endowment-hero-closed">Donations open soon.</p>`;

  return `<section class="endowment-hero">
    <div class="endowment-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide endowment-hero-inner">
      <h1 class="endowment-brand">Endowment</h1>
      <p class="endowment-lede">${escapeHtml(ENDOWMENT_BLURB)}</p>
      ${signal}
      ${cta}
    </div>
  </section>`;
}

function howItWorksHtml(): string {
  const wanted = href("/wanted");
  const steps = ENDOWMENT_HOW_STEPS.map((step, i) => {
    let body = escapeHtml(step.body);
    if (i === 1) {
      body = body.replace(
        /most-wanted work/,
        `<a href="${wanted}">most-wanted</a> work`,
      );
    }
    return `<li class="endowment-how-step">
      <strong>${escapeHtml(step.title)}</strong>
      <p>${body}</p>
    </li>`;
  }).join("");
  return `<section class="endowment-how" aria-labelledby="endowment-how-heading">
    <h2 id="endowment-how-heading">How it works</h2>
    <ol class="endowment-how-list">${steps}</ol>
  </section>`;
}

function contributionsHtml(
  contributions: EndowmentContribution[],
  titleById: Map<string, string>,
  pathById: Map<string, string>,
): string {
  if (!contributions.length) {
    return `<section class="endowment-contributions" id="contributions">
      <div class="endowment-funded-head">
        <h2>Contributions</h2>
      </div>
      <p class="muted">No monthly contributions listed yet.</p>
    </section>`;
  }

  const rows = contributions
    .map((g) => {
      const key = g.proposal_id.trim().toLowerCase();
      const title = titleById.get(key) || g.proposal_id;
      const path = pathById.get(key);
      const project = path
        ? `<a href="${proposalHref(path, g.proposal_id)}">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      const when = g.granted_at
        ? new Date(g.granted_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "—";
      const tx = g.txid
        ? `<a class="mono endowment-tx-link" href="${mempoolWeb()}/tx/${encodeURIComponent(
            g.txid,
          )}" target="_blank" rel="noreferrer noopener">${escapeHtml(
            `${g.txid.slice(0, 8)}…`,
          )}</a>`
        : "";
      return `<li class="endowment-contrib-row">
        <time datetime="${escapeHtml(g.granted_at)}">${escapeHtml(when)}</time>
        <span class="endowment-contrib-project">${project}</span>
        <span class="mono endowment-contrib-amount">${escapeHtml(
          formatSats(g.amount_sats),
        )}</span>
        ${tx ? `<span class="endowment-contrib-tx">${tx}</span>` : ""}
      </li>`;
    })
    .join("");

  return `<section class="endowment-contributions" id="contributions">
    <div class="endowment-funded-head">
      <h2>Contributions</h2>
      <p class="muted">${contributions.length === 1 ? "1 entry" : `${contributions.length} entries`}</p>
    </div>
    <ul class="endowment-contrib-list">${rows}</ul>
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

function scrollToHashIfNeeded(): void {
  const hash = location.hash.replace(/^#/, "");
  if (hash !== "funded" && hash !== "contributions") return;
  document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
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
    const [view, listed, user] = await Promise.all([
      fetchEndowment(),
      listListedProposals().catch(() => [] as Proposal[]),
      fetchCurrentUser().catch(() => null),
    ]);
    const signedIn = Boolean(user);
    const fundedSet = new Set(
      view.funded_proposal_ids.map((id) => id.trim().toLowerCase()),
    );
    const titleById = new Map<string, string>();
    const pathById = new Map<string, string>();
    for (const p of listed) {
      if (!p.id) continue;
      const key = p.id.trim().toLowerCase();
      titleById.set(key, p.title || p.id);
      if (p.path) pathById.set(key, p.path);
    }
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
        ${howItWorksHtml()}
        ${contributionsHtml(view.contributions, titleById, pathById)}
        <section class="endowment-funded" id="funded">
          <div class="endowment-funded-head">
            <h2>Funded projects</h2>
            <p class="muted">${escapeHtml(countLabel)}</p>
          </div>
          ${fundedCardsHtml(funded, Boolean(view.lightning_available))}
        </section>
      `)}
      ${
        open && view.address
          ? endowmentDonateModalHtml(view.address, { signedIn })
          : ""
      }
    `);

    if (view.address && open) {
      bindDonateModal(app, {
        open: wantsDonateOpen(),
        rail: wantsLnRail() ? "lightning" : undefined,
      });
      await bindDonatePanel(app, {
        address: view.address,
        proposalId: "endowment",
        proposalPath: "/endowment",
        proposalTitle: "Endowment",
        mode: "endowment",
        signedIn,
        creditPrefs: user?.funder_credit
          ? {
              public_credit: Boolean(user.funder_credit.public_credit),
              anonymous: user.funder_credit.public_credit === false,
              show_amount: Boolean(user.funder_credit.show_amount),
            }
          : null,
      });
    }
    const fundedRoot = app.querySelector("#funded");
    if (fundedRoot) {
      bindCardWatches(fundedRoot, new Set());
      void hydrateAvatarSlots(fundedRoot);
    }
    scrollToHashIfNeeded();
  } catch {
    app.innerHTML = shell(`
      ${heroHtml({ open: false, sats: 0, goal: 0 })}
      ${bodyHtml(`<p class="muted">Could not load endowment right now.</p>`)}
    `);
  }
}
