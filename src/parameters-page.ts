import { WORKERS_API } from "./config";
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
  app.innerHTML = shell(`
    <section class="wrap-wide detail">
      <header class="declined-head">
        <p class="eyebrow"><a href="${href("/about")}">About</a></p>
        <h1>Parameters</h1>
        <p class="lede">Fees are git-canonical. Completions do not change them. Keyholders are paid from a monthly batch, not per project.</p>
      </header>
      <dl class="about-params">
        <div class="about-param">
          <dt>Platform fee</dt>
          <dd><span class="about-param-value">${escapeHtml(String(platform))}%</span>
          <span class="about-param-hint">Of that month’s disbursed bounty total.</span></dd>
        </div>
        <div class="about-param">
          <dt>Keyholder fee</dt>
          <dd><span class="about-param-value">${escapeHtml(String(kh))}%</span>
          <span class="about-param-hint">Split among signers of that month’s PSBT. Cap ${escapeHtml(formatSats(cap))} per keyholder. Overflow to platform. The fee address holds the pool until cash-out.</span></dd>
        </div>
        <div class="about-param">
          <dt>Total take</dt>
          <dd><span class="about-param-value">${escapeHtml(String(platform + kh))}%</span>
          <span class="about-param-hint">One fee-address output in the monthly release. Bond and contributor refunds are 0%.</span></dd>
        </div>
      </dl>
      <h2>Active keyholders</h2>
      ${
        roster.length
          ? `<table class="about-keyholders-table"><thead><tr><th>Handle</th><th>Fingerprint</th><th>xpub</th><th>Signed</th></tr></thead><tbody>${roster
              .map(
                (k) =>
                  `<tr><td>${escapeHtml(k.github)}</td><td class="mono">${escapeHtml(k.fingerprint || "—")}</td><td class="mono about-kh-xpub">${escapeHtml(k.xpub || "—")}</td><td>${escapeHtml(String(k.signing_count || 0))}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="muted">No active keyholders published yet.</p>`
      }
      <p class="muted"><a href="${href("/docs/keyholder-responsibilities.md")}">Keyholder responsibilities</a> · <a href="${projectsHref()}">Projects</a></p>
    </section>
  `);
}
