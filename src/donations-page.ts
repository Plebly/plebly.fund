import { WORKERS_API } from "./config";
import { endowmentBalanceView, endowmentGiveAllowed } from "./endowment-balance";
import { applySeo, href, proposalHref, projectsHref, seoForRoute } from "./router";
import { escapeHtml, formatSats, timeAgoHtml } from "./util";
import { displayHandle, displayIdentity, isRawIdentityKey, looksLikeProjectId } from "./display-names";
import { projectRefHtml, projectTitles } from "./project-titles";

export type DonationsShell = (inner: string) => string;

export type PublicDonation = {
  id: string;
  amount_sats: number;
  /** shared_escrow: gifts to 001–008's shared address (workers reads former endowment rows so while shared). */
  target_type: "endowment" | "project" | "shared_escrow";
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
    donations: await withDisplayLabels(Array.isArray(body.donations) ? body.donations : []),
    total: Math.max(0, Math.floor(Number(body.total) || 0)),
  };
}

/**
 * Ledger rows name people and projects for humans: a project row whose label
 * is only its id gets the catalog title, and a raw key donor (`a5a22eaf…33f6`,
 * `nostr:<hex>`) gets the short form. Rows stay as sent when no title is found.
 */
export async function withDisplayLabels(rows: PublicDonation[]): Promise<PublicDonation[]> {
  const needTitle = rows.filter(
    (d) => d.target_type === "project" && looksLikeProjectId(d.target_label, d.target_id),
  );
  const titles = needTitle.length
    ? await projectTitles(needTitle.map((d) => d.target_id)).catch(() => new Map<string, string>())
    : new Map<string, string>();
  return rows.map((d) => {
    let next = d;
    const title =
      d.target_type === "project" ? titles.get(String(d.target_id || "").toLowerCase()) : undefined;
    if (title) next = { ...next, target_label: title };
    if (next.donor_display && isRawIdentityKey(next.donor_display)) {
      next = { ...next, donor_display: displayIdentity(next.donor_display) };
    }
    return next;
  });
}

export const SHARED_ESCROW_LABEL = "Shared escrow (001–008)";

/**
 * Link for a donation's target, or null when it has no page (shared escrow,
 * unknown types, and `endowment` rows while the endowment isn't open: an older
 * workers still stores shared-address gifts as `endowment`).
 */
export function donationTargetHref(d: PublicDonation, endowmentOpen: boolean): string | null {
  if (d.target_type === "endowment") return endowmentOpen ? href("/endowment") : null;
  if (d.target_type === "project") return proposalHref("", d.target_id);
  return null;
}

/** Target as a link, or plain text when it has no page. */
export function donationTargetHtml(
  d: PublicDonation,
  className: string,
  label: string,
  endowmentOpen: boolean,
): string {
  const to = donationTargetHref(d, endowmentOpen);
  // Projects: title first, catalog id as quiet secondary text.
  const inner =
    d.target_type === "project" && d.target_id && !looksLikeProjectId(label, d.target_id)
      ? projectRefHtml(d.target_id, label)
      : escapeHtml(label);
  return to
    ? `<a class="${className}" href="${to}">${inner}</a>`
    : `<span class="${className}">${inner}</span>`;
}

/**
 * True only when the endowment has its own address (workers#115 view). A
 * shared address, a missing flag (older API) or a failed read all hide the
 * endowment wording and links.
 */
export const ENDOWMENT_READ_TIMEOUT_MS = 4_000;

export async function fetchEndowmentOpen(): Promise<boolean> {
  if (!WORKERS_API) return false;
  // The ledger waits on this read (the /donations Promise.all, the live
  // strip's first paint), so a hung /endowment must not hang the ledger: after
  // ENDOWMENT_READ_TIMEOUT_MS give up (abort the request) and keep the
  // endowment wording hidden. The race also covers a body that stalls after
  // the headers arrive.
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(false);
    }, ENDOWMENT_READ_TIMEOUT_MS);
  });
  const read = (async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API()}/endowment`, { signal: ctrl.signal });
      if (!res || !res.ok) return false;
      return endowmentGiveAllowed(endowmentBalanceView(await res.json()));
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([read, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export function donationsLedeText(endowmentOpen: boolean, total = 0): string {
  const base = endowmentOpen
    ? "Confirmed gifts to projects and the endowment"
    : "Confirmed gifts to projects";
  return `${base}${total ? ` (${total})` : ""}.`;
}

export function donationRowCopy(d: PublicDonation, endowmentOpen: boolean): {
  donor: string;
  amount: string;
  target: string;
} {
  const donor =
    d.anonymous || !d.donor_display
      ? "Anonymous"
      : displayHandle(d.donor_display);
  return {
    donor,
    amount: formatSats(d.amount_sats),
    target:
      d.target_type === "endowment" && !endowmentOpen
        ? SHARED_ESCROW_LABEL
        : d.target_label || d.target_id || "a project",
  };
}

function rowHtml(d: PublicDonation, endowmentOpen: boolean): string {
  const { donor, amount, target } = donationRowCopy(d, endowmentOpen);
  const when = timeAgoHtml(d.donated_at);
  return `<li class="donations-row" data-donation-id="${escapeHtml(d.id)}">
    <span class="donations-donor">${escapeHtml(donor)}</span>
    <span class="donations-verb">donated</span>
    <span class="donations-amount mono">${escapeHtml(amount)}</span>
    <span class="donations-verb">to</span>
    ${donationTargetHtml(d, "donations-target", target, endowmentOpen)}
    ${when ? `<span class="donations-when muted">${when}</span>` : ""}
  </li>`;
}

export async function renderDonations(shell: DonationsShell): Promise<void> {
  applySeo(seoForRoute({ name: "donations" }));
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const params = new URLSearchParams(location.search);
  const pageParam = Math.floor(Number(params.get("page")));
  const page = Number.isFinite(pageParam) && pageParam > 1 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  app.innerHTML = shell(`
    <section class="wrap-wide declined-page donations-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Ledger</p>
        <h1>Donations</h1>
        <p class="lede">${escapeHtml(donationsLedeText(false))}</p>
      </header>
      <p class="muted">Loading…</p>
    </section>
  `);

  try {
    const [{ donations, total }, endowmentOpen] = await Promise.all([
      fetchPublicDonations({ limit: PAGE_SIZE, offset }),
      fetchEndowmentOpen(),
    ]);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    // ?page past the end (e.g. a stale link): go to the last real page instead
    // of "Page 99 of 3" over an empty "No confirmed donations yet".
    if (page > pages && total > 0) {
      history.replaceState(history.state, "", href("/donations", pages > 1 ? `?page=${pages}` : ""));
      return renderDonations(shell);
    }
    const list = donations.length
      ? `<ul class="donations-list">${donations.map((d) => rowHtml(d, endowmentOpen)).join("")}</ul>`
      : `<div class="empty-state">
          <p class="empty-state-title">No confirmed donations yet</p>
          <p class="empty-state-body"><a href="${projectsHref()}">Fund a project</a>${
            endowmentOpen ? ` or <a href="${href("/endowment")}">give to the endowment</a>` : ""
          }.</p>
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
          <p class="lede">${escapeHtml(donationsLedeText(endowmentOpen, total))}</p>
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
