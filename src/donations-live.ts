import {
  donationRowCopy,
  donationTargetHref,
  fetchPublicDonations,
  type PublicDonation,
} from "./donations-page";
import { href } from "./router";
import { escapeHtml, timeAgoHtml } from "./util";

const POLL_MS = 15_000;

function liveRowHtml(d: PublicDonation, isNew: boolean): string {
  const { donor, amount, target } = donationRowCopy(d);
  const when = timeAgoHtml(d.donated_at);
  return `<li class="donations-live-row${isNew ? " is-new" : ""}" data-donation-id="${escapeHtml(d.id)}">
    <p class="donations-live-copy">
      <span class="donations-live-donor">${escapeHtml(donor)}</span>
      donated
      <span class="donations-live-amount mono">${escapeHtml(amount)}</span>
      to
      <a class="donations-live-target" href="${donationTargetHref(d)}">${escapeHtml(target)}</a>
    </p>
    ${when ? `<p class="donations-live-when muted">${when}</p>` : ""}
  </li>`;
}

function panelHtml(rows: PublicDonation[], knownIds: Set<string>): string {
  const list = rows.length
    ? `<ul class="donations-live-list">${rows
        .map((d) => liveRowHtml(d, knownIds.size > 0 && !knownIds.has(d.id)))
        .join("")}</ul>`
    : `<div class="donations-live-empty">
        <p>No confirmed gifts yet — be the first.</p>
        <p class="muted"><a href="${href("/endowment")}">Donate to the endowment</a> · <a href="${href("/", "", "#projects")}">Fund a project</a></p>
      </div>`;

  return `<section class="wrap-wide donations-live" id="donations-live" aria-labelledby="donations-live-heading">
    <div class="rail-head donations-live-head">
      <div>
        <p class="donations-live-kicker"><span class="donations-live-dot" aria-hidden="true"></span> Live</p>
        <h2 id="donations-live-heading">Recent donations</h2>
        <p>Live gifts into projects and the endowment.</p>
      </div>
      <a href="${href("/donations")}">Full ledger →</a>
    </div>
    ${list}
  </section>`;
}

export async function bindDonationsLive(root: ParentNode): Promise<void> {
  const mount = root.querySelector<HTMLElement>("#donations-live-mount");
  if (!mount) return;

  let known = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const paint = async (initial: boolean) => {
    try {
      const { donations } = await fetchPublicDonations({ limit: 10, offset: 0 });
      mount.innerHTML = panelHtml(donations, initial ? new Set() : known);
      known = new Set(donations.map((d) => d.id));
      // Clear enter animation class after it plays.
      window.setTimeout(() => {
        mount
          .querySelectorAll(".donations-live-row.is-new")
          .forEach((el) => el.classList.remove("is-new"));
      }, 900);
    } catch {
      if (initial) {
        mount.innerHTML = `<section class="wrap-wide donations-live" id="donations-live">
          <div class="rail-head"><div><h2>Recent donations</h2><p class="muted">Could not load live gifts.</p></div>
          <a href="${href("/donations")}">Full ledger →</a></div>
        </section>`;
      }
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void paint(false).finally(schedule);
    }, POLL_MS);
  };

  await paint(true);
  schedule();

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  const obs = new MutationObserver(() => {
    if (!document.contains(mount)) {
      stop();
      obs.disconnect();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}
