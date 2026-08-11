import { WORKERS_API } from "./config";
import { applySeo, href, proposalHref, projectsHref, seoForRoute } from "./router";
import { escapeHtml, formatSats, timeAgoHtml } from "./util";

export type DonationsShell = (inner: string) => string;

export type PublicDonation = {
  id: string;
  amount_sats: number;
  target_type: "endowment" | "project";
  target_id: string;
  target_label: string;
  donated_at: string;
  anonymous: boolean;
  donor_display: string | null;
};

const API = () => WORKERS_API.replace(/\/$/, "");
const PAGE_SIZE = 40;

export async function fetchPublicDonations(opts?: {
  limit?: number;
  offset?: number;
}): Promise<{ donations: PublicDonation[]; total: number }> {
  if (!WORKERS_API) return { donations: [], total: 0 };
  const limit = opts?.limit ?? PAGE_SIZE;
  const offset = opts?.offset ?? 0;
  const res = await fetch(
    `${API()}/donations?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`,
  );
  if (!res.ok) throw new Error(`Could not load donations (${res.status})`);
  const body = (await res.json()) as {
    donations?: PublicDonation[];
    total?: number;
  };
  return {
    donations: Array.isArray(body.donations) ? body.donations : [],
    total: Math.max(0, Math.floor(Number(body.total) || 0)),
  };
}

export function donationTargetHref(d: PublicDonation): string {
  if (d.target_type === "endowment") return href("/endowment");
  return proposalHref("", d.target_id);
}

export function donationRowCopy(d: PublicDonation): {
  donor: string;
  amount: string;
  target: string;
} {
  const donor =
    d.anonymous || !d.donor_display
      ? "Anonymous"
      : `@${d.donor_display.replace(/^@/, "")}`;
  return {
    donor,
    amount: formatSats(d.amount_sats),
    target: d.target_label || d.target_id || "a project",
  };
}

function rowHtml(d: PublicDonation): string {
  const { donor, amount, target } = donationRowCopy(d);
  const when = timeAgoHtml(d.donated_at);
  return `<li class="donations-row">
    <span class="donations-donor">${escapeHtml(donor)}</span>
    <span class="donations-verb">donated</span>
    <span class="donations-amount mono">${escapeHtml(amount)}</span>
    <span class="donations-verb">to</span>
    <a class="donations-target" href="${donationTargetHref(d)}">${escapeHtml(target)}</a>
    ${when ? `<span class="donations-when muted">${when}</span>` : ""}
  </li>`;
}

export async function renderDonations(shell: DonationsShell): Promise<void> {
  applySeo(seoForRoute({ name: "donations" }));
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const params = new URLSearchParams(location.search);
  const page = Math.max(1, Math.floor(Number(params.get("page") || 1)));
  const offset = (page - 1) * PAGE_SIZE;

  app.innerHTML = shell(`
    <section class="wrap-wide declined-page donations-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Ledger</p>
        <h1>Donations</h1>
        <p class="lede">Confirmed gifts to projects and the endowment.</p>
      </header>
      <p class="muted">Loading…</p>
    </section>
  `);

  try {
    const { donations, total } = await fetchPublicDonations({
      limit: PAGE_SIZE,
      offset,
    });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const list = donations.length
      ? `<ul class="donations-list">${donations.map(rowHtml).join("")}</ul>`
      : `<div class="empty-state">
          <p class="empty-state-title">No confirmed donations yet</p>
          <p class="empty-state-body"><a href="${projectsHref()}">Fund a project</a> or <a href="${href("/endowment")}">give to the endowment</a>.</p>
        </div>`;

    const pager =
      pages > 1
        ? `<nav class="donations-pager" aria-label="Donations pages">
            ${
              page > 1
                ? `<a href="${href("/donations", `?page=${page - 1}`)}">← Newer</a>`
                : `<span class="muted">← Newer</span>`
            }
            <span class="muted">Page ${page} of ${pages}</span>
            ${
              page < pages
                ? `<a href="${href("/donations", `?page=${page + 1}`)}">Older →</a>`
                : `<span class="muted">Older →</span>`
            }
          </nav>`
        : "";

    app.innerHTML = shell(`
      <section class="wrap-wide declined-page donations-page">
        <header class="declined-head">
          <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Ledger</p>
          <h1>Donations</h1>
          <p class="lede">Confirmed gifts to projects and the endowment${
            total ? ` (${total})` : ""
          }.</p>
        </header>
        ${list}
        ${pager}
      </section>
    `);
  } catch {
    app.innerHTML = shell(`
      <section class="wrap-wide declined-page donations-page">
        <header class="declined-head">
          <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Ledger</p>
          <h1>Donations</h1>
        </header>
        <p class="muted">Could not load the donations ledger right now.</p>
      </section>
    `);
  }
}
