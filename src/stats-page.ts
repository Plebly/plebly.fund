import { CORE_ANNUAL_GAP_SATS } from "./config";
import { listListedProposals } from "./github";
import { addressBalanceSats } from "./mempool";
import { href } from "./router";
import type { Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

export type StatsShell = (inner: string) => string;

async function enrichBalances(proposals: Proposal[]): Promise<Proposal[]> {
  return Promise.all(
    proposals.map(async (proposal) => {
      if (!proposal.escrow_address) return proposal;
      try {
        return { ...proposal, balance_sats: await addressBalanceSats(proposal.escrow_address) };
      } catch {
        return proposal;
      }
    }),
  );
}

function statHtml(label: string, value: string, detail: string): string {
  return `<div class="stats-metric">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value)}</dd>
    <p>${escapeHtml(detail)}</p>
  </div>`;
}

export async function renderStats(shell: StatsShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`<section class="wrap detail stats-page"><p class="loading">Loading public totals…</p></section>`);

  try {
    const proposals = await enrichBalances(await listListedProposals());
    const completed = proposals.filter((proposal) => String(proposal.status) === "completed");
    const claimed = proposals.filter((proposal) =>
      ["claimed", "in_review", "completed"].includes(String(proposal.status)),
    );
    const escrowed = proposals.reduce((sum, proposal) => sum + (proposal.balance_sats || 0), 0);
    const paidEstimate = completed.reduce(
      (sum, proposal) => sum + (proposal.target_sats ?? proposal.balance_sats ?? 0),
      0,
    );
    const gapPercent = CORE_ANNUAL_GAP_SATS
      ? Math.min(100, Math.round((escrowed / CORE_ANNUAL_GAP_SATS) * 100))
      : 0;

    app.innerHTML = shell(`<section class="wrap detail stats-page">
      <p class="eyebrow">Public ledger</p>
      <h1>Funding stats</h1>
      <p class="lede">Best-effort totals from public proposal files and on-chain escrow balances. Plebly does not custody or settle these funds.</p>
      <dl class="stats-grid">
        ${statHtml("Currently escrowed", formatSats(escrowed), escrowed ? "Live balances across listed projects" : "No public escrow balance is tracked yet")}
        ${statHtml("Completed projects", String(completed.length), completed.length ? "Publicly marked completed" : "Completed work will appear here after public review")}
        ${statHtml("Completed targets", formatSats(paidEstimate), completed.length ? "Target amounts for completed projects; actual payouts remain on-chain verifiable" : "No completed project target is recorded yet")}
        ${statHtml("Claim completion rate", claimed.length ? `${Math.round((completed.length / claimed.length) * 100)}%` : "-", claimed.length ? "Completed among claimed and reviewed projects" : "Shown once a project enters the claim lifecycle")}
      </dl>
      <section class="gap-ticker stats-gap">
        <div>
          <span class="gap-ticker-label">Core annual gap</span>
          <strong>${formatSats(escrowed)} <span>of ${formatSats(CORE_ANNUAL_GAP_SATS)}</span></strong>
        </div>
        <div class="gap-ticker-meter" role="progressbar" aria-label="Core annual gap funded" aria-valuemin="0" aria-valuemax="${CORE_ANNUAL_GAP_SATS}" aria-valuenow="${escrowed}"><span style="width: ${gapPercent}%"></span></div>
        <p>${gapPercent}% represented by currently escrowed public funds.</p>
      </section>
      <p class="stats-source">Figures refresh when this page loads. <a href="${href("/")}">Browse projects</a> · <a href="${href("/about")}#trust">Read the trust model</a>.</p>
    </section>`);
  } catch (error) {
    app.innerHTML = shell(`<section class="wrap detail stats-page">
      <h1>Funding stats</h1>
      <div class="error">${escapeHtml((error as Error).message)}</div>
    </section>`);
  }
}
