import { WORKERS_API } from "./config";
import { platformUsesEscrow } from "./funding-route";
import {
  KEYHOLDER_CAP_SATS,
  KEYHOLDER_FEE_PERCENT,
  PLATFORM_FEE_PERCENT,
} from "./generated/parameters";
import { href, projectsHref } from "./router";
import { escapeHtml, formatSats } from "./util";

export type ParametersShell = (inner: string) => string;

const api = () => WORKERS_API.replace(/\/$/, "");

type ParamsPayload = {
  platform_fee_percent: number;
  keyholder_fee_percent: number;
  total_fee_percent: number;
  keyholder_cap_sats: number;
  keyholders: {
    github: string;
    xpub: string | null;
    fingerprint: string | null;
    invited_at?: string;
    signing_count?: number;
  }[];
  funding_route?: string;
};

export async function renderParameters(shell: ParametersShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap-wide detail">
      <p class="loading">Loading parameters…</p>
    </section>
  `);
  const res = await fetch(`${api()}/parameters`).catch(() => null);
  const live = res?.ok
    ? ((await res.json()) as ParamsPayload)
    : null;
  const platform = live?.platform_fee_percent ?? PLATFORM_FEE_PERCENT;
  const kh = live?.keyholder_fee_percent ?? KEYHOLDER_FEE_PERCENT;
  const cap = live?.keyholder_cap_sats ?? KEYHOLDER_CAP_SATS;
  const roster = live?.keyholders || [];
  const escrowOn = platformUsesEscrow(live?.funding_route);
  const routeRow = `<div class="about-param">
          <dt>Funding route for new listings</dt>
          <dd><span class="about-param-value">${escrowOn ? "Multisig escrow" : "Pay the builder"}</span>
          <span class="about-param-hint">${
            escrowOn
              ? "A keyholder quorum set new listings to multisig escrow. A listing keeps the route it was listed with."
              : "New listings pay the builder. That payment is final and takes no fee."
          }</span></dd>
        </div>`;
  const escrowFees = escrowOn
    ? `<div class="about-param">
          <dt>Platform fee</dt>
          <dd><span class="about-param-value">${escapeHtml(String(platform))}%</span>
          <span class="about-param-hint">Of that month’s disbursed bounty total.</span></dd>
        </div>
        <div class="about-param">
          <dt>Keyholder fee</dt>
          <dd><span class="about-param-value">${escapeHtml(String(kh))}%</span>
          <span class="about-param-hint">Split among the keyholders who signed that month. Cap ${escapeHtml(formatSats(cap))} per keyholder.</span></dd>
        </div>
        <div class="about-param">
          <dt>Total take</dt>
          <dd><span class="about-param-value">${escapeHtml(String(platform + kh))}%</span>
          <span class="about-param-hint">Taken from an escrow payout. A direct payment has no fee. Bond and donor refunds are 0%.</span></dd>
        </div>`
    : "";
  const rosterHtml = escrowOn
    ? `<h2>Active keyholders</h2>
      ${
        roster.length
          ? `<table class="about-keyholders-table"><thead><tr><th>Handle</th><th>Fingerprint</th><th>xpub</th><th>Signed</th></tr></thead><tbody>${roster
              .map(
                (k) =>
                  `<tr><td>${escapeHtml(k.github)}</td><td class="mono">${escapeHtml(k.fingerprint || "—")}</td><td class="mono about-kh-xpub">${escapeHtml(k.xpub || "—")}</td><td>${escapeHtml(String(k.signing_count || 0))}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="muted">No active keyholders published yet.</p>`
      }`
    : "";
  app.innerHTML = shell(`
    <section class="wrap-wide detail">
      <header class="declined-head">
        <p class="eyebrow"><a href="${href("/about")}">About</a></p>
        <h1>Parameters</h1>
        <p class="lede">${
          escrowOn
            ? "These fees apply when an escrow pays out. A payment straight to the builder has no platform fee. Keyholders sign escrow payouts, from a monthly batch, not per project."
            : "New listings pay the builder. That payment is final and takes no fee."
        }</p>
      </header>
      <dl class="about-params">
        ${escrowFees}
        ${routeRow}
      </dl>
      ${rosterHtml}
      <p class="muted">Some dispute votes pay 10,000 sats each, from forfeited claim bonds. That payment is not enabled yet. Ordinary completion review is unpaid.</p>
      <p class="muted"><a href="${href("/reviewer-responsibilities")}">Reviewer rules</a>${
        escrowOn
          ? ` · <a href="${href("/keyholder-responsibilities")}">Keyholder responsibilities</a>`
          : ""
      } · <a href="${href("/terms")}">Terms</a> · <a href="${projectsHref()}">Projects</a></p>
    </section>
  `);
}
