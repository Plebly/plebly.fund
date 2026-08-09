import { claimFloorShortfall } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import { listListedProposals } from "./github";
import { addressBalanceSats } from "./mempool";
import { href, projectsHref } from "./router";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type StatsShell = (inner: string) => string;

export type PublicStats = {
  tracked: number;
  open: number;
  completed: number;
  claimedLifecycle: number;
  escrowed: number;
  paidEstimate: number;
  completionRate: number | null;
  shortfallSats: number;
  belowFloorCount: number;
  fundedTowardFloor: number;
};

async function enrichBalances(proposals: Proposal[]): Promise<Proposal[]> {
  return Promise.all(
    proposals.map(async (proposal) => {
      if (!proposal.escrow_address) return proposal;
      if (typeof proposal.balance_sats === "number") return proposal;
      try {
        return {
          ...proposal,
          balance_sats: await addressBalanceSats(proposal.escrow_address),
        };
      } catch {
        return proposal;
      }
    }),
  );
}

/** Pure totals for tests and rendering. */
export function computePublicStats(proposals: Proposal[]): PublicStats {
  const completed = proposals.filter(
    (proposal) => String(proposal.status) === "completed",
  );
  const claimedLifecycle = proposals.filter((proposal) =>
    ["claimed", "in_review", "completed"].includes(String(proposal.status)),
  );
  const open = proposals.filter((proposal) =>
    ["listed", "funding", "claimable", "claimed", "in_review"].includes(
      String(proposal.status),
    ),
  );
  const escrowed = proposals.reduce(
    (sum, proposal) => sum + (proposal.balance_sats || 0),
    0,
  );
  const paidEstimate = completed.reduce(
    (sum, proposal) =>
      sum + (proposal.target_sats ?? proposal.balance_sats ?? 0),
    0,
  );
  const completionRate = claimedLifecycle.length
    ? Math.round((completed.length / claimedLifecycle.length) * 100)
    : null;
  const shortfall = claimFloorShortfall(proposals, CLAIM_FLOOR_SATS);

  return {
    tracked: proposals.length,
    open: open.length,
    completed: completed.length,
    claimedLifecycle: claimedLifecycle.length,
    escrowed,
    paidEstimate,
    completionRate,
    shortfallSats: shortfall.shortfallSats,
    belowFloorCount: shortfall.projectCount,
    fundedTowardFloor: shortfall.fundedTowardFloor,
  };
}

function supportMetricHtml(
  label: string,
  value: string,
  detail: string,
): string {
  return `<div class="stats-metric">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}</dd>
    <p>${escapeHtml(detail)}</p>
  </div>`;
}

function gapSectionHtml(stats: PublicStats): string {
  if (stats.belowFloorCount === 0) {
    return `<section class="stats-gap" aria-labelledby="stats-gap-title">
      <div class="stats-gap-copy">
        <p class="stats-gap-eyebrow" id="stats-gap-title">Claim floor</p>
        <p class="stats-gap-lede">Open projects are at or above the claim floor — builders can claim when rules allow.</p>
        <p class="stats-gap-figures"><strong>Floor met</strong></p>
      </div>
      <div class="stats-gap-visual">
        <p class="stats-gap-percent mono">100%</p>
        <div class="stats-gap-meter" role="progressbar" aria-label="Claim floor progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span style="width: 100%"></span></div>
        <p class="stats-gap-note"><a href="${projectsHref()}">Browse projects</a></p>
      </div>
    </section>`;
  }
  const capacity = stats.fundedTowardFloor + stats.shortfallSats;
  const percent = Math.min(
    100,
    Math.round((stats.fundedTowardFloor / Math.max(1, capacity)) * 100),
  );
  const projectLabel =
    stats.belowFloorCount === 1
      ? "1 open project"
      : `${stats.belowFloorCount} open projects`;
  return `<section class="stats-gap" aria-labelledby="stats-gap-title">
    <div class="stats-gap-copy">
      <p class="stats-gap-eyebrow" id="stats-gap-title">Claim-floor shortfall</p>
      <p class="stats-gap-lede">${escapeHtml(projectLabel)} still need confirmed sats to become claimable.</p>
      <p class="stats-gap-figures">
        <strong>${escapeHtml(formatSats(stats.shortfallSats))}</strong>
        <span>to claim floor</span>
      </p>
    </div>
    <div class="stats-gap-visual">
      <p class="stats-gap-percent mono">${percent}%</p>
      <div
        class="stats-gap-meter"
        role="progressbar"
        aria-label="Progress toward claim floor across underfunded projects"
        aria-valuemin="0"
        aria-valuemax="${capacity}"
        aria-valuenow="${stats.fundedTowardFloor}"
      ><span style="width: ${percent}%"></span></div>
      <p class="stats-gap-note"><a href="${projectsHref("?size=below-floor")}">Fund below-floor projects</a></p>
    </div>
  </section>`;
}

function statsBodyHtml(stats: PublicStats): string {
  const rateValue =
    stats.completionRate == null ? "—" : `${stats.completionRate}%`;
  const rateDetail =
    stats.claimedLifecycle > 0
      ? `${stats.completed} completed of ${stats.claimedLifecycle} that entered claim or review`
      : "Shown once a project enters the claim lifecycle";

  return `<section class="wrap detail stats-page">
    <header class="stats-hero">
      <p class="about-eyebrow">Public ledger</p>
      <h1>Funding stats</h1>
      <p class="lede">Best-effort totals from public proposal files and on-chain escrow balances. Plebly does not custody or settle these funds.</p>
    </header>

    <section class="stats-primary" aria-labelledby="stats-escrowed-label">
      <p class="stats-primary-label" id="stats-escrowed-label">Currently escrowed</p>
      <p class="stats-primary-value mono">${escapeHtml(formatSats(stats.escrowed))}</p>
      <p class="stats-primary-detail">${
        stats.escrowed
          ? `Live confirmed balances across ${stats.tracked} tracked project${stats.tracked === 1 ? "" : "s"}`
          : "No public escrow balance is tracked yet"
      }</p>
    </section>

    <dl class="stats-support">
      ${supportMetricHtml(
        "Open projects",
        String(stats.open),
        stats.open
          ? "Listed, funding, claimable, claimed, or in review"
          : "No open projects in the public index yet",
      )}
      ${supportMetricHtml(
        "Completed",
        String(stats.completed),
        stats.completed
          ? `Targets sum to ${formatSats(stats.paidEstimate)} · payouts stay on-chain verifiable`
          : "Completed work appears here after public review and keyholder release",
      )}
      ${supportMetricHtml("Claim completion", rateValue, rateDetail)}
    </dl>

    ${gapSectionHtml(stats)}

    <footer class="stats-foot">
      <p class="stats-source">Figures refresh when this page loads.</p>
      <div class="stats-actions">
        <a class="btn" href="${projectsHref()}">Browse projects</a>
        <a class="btn ghost" href="${href("/about")}#trust">Trust model</a>
      </div>
    </footer>
  </section>`;
}

export async function renderStats(shell: StatsShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(
    `<section class="wrap detail stats-page"><p class="loading">Loading public totals…</p></section>`,
  );

  try {
    const proposals = await enrichBalances(await listListedProposals());
    const stats = computePublicStats(proposals);
    app.innerHTML = shell(statsBodyHtml(stats));
  } catch (error) {
    app.innerHTML = shell(`<section class="wrap detail stats-page">
      <header class="stats-hero">
        <p class="about-eyebrow">Public ledger</p>
        <h1>Funding stats</h1>
      </header>
      <div class="error">${escapeHtml((error as Error).message)}</div>
      <p class="stats-source"><a href="${projectsHref()}">Browse projects</a></p>
    </section>`);
  }
}
