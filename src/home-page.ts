import {
  addWatch,
  claimFloorShortfall,
  fetchWanted,
  fetchWatchMetaBatch,
  fetchWatches,
  isNearFloor,
  isOpenToClaim,
  isTakenStatus,
  removeWatch,
  watchStorageId,
} from "./builder";
import { CLAIM_FLOOR_SATS, WORKERS_API, lightningUiAllowed } from "./config";
import { listListedProposals } from "./github";
import { fetchLightningStatus } from "./lightning";
import { safeHttpsImageUrl } from "./media";
import { addressBalanceSats } from "./mempool";
import { claimModeChipHtml, refreshClaimModeChips } from "./claim-mode-ui";
import {
  endowmentMeterHtml,
  fundingBarTrackHtml,
  fundingTargetSats,
  isPastFundingTarget,
  overfundRatioLabel,
  statusLabel,
  statusPillHtml,
} from "./proposal-ui";
import { isSignet, signetHeroNoteHtml } from "./signet";
import type { Proposal } from "./types";
import { projectCardProposerHtml } from "./github-orgs-client";
import { href, orgHref, profileHref, projectsHref, proposalHref } from "./router";
import { hydrateAvatarSlots, orgAvatarSlotHtml } from "./profile-avatars";
import { escapeHtml, formatSats } from "./util";
import { fetchProposalViewsBatch } from "./views";
import { bindActivityStrip } from "./activity";

export type HomeShell = (inner: string) => string;

type SortKey = "funded" | "newest" | "floor";
type ClaimFilter = "all" | "open" | "near" | "taken";
type TypeFilter = "all" | "bounty" | "direct";
type SizeFilter = "all" | "below-floor" | "at-floor" | "overfunded";
type WindowFilter = "all" | "soon" | "ended";

function networkBadgeHtml(): string {
  return `<span class="network-badge ${isSignet() ? "network-badge-test" : ""}">${isSignet() ? "Signet · test coins" : "Mainnet"}</span>`;
}

function excerptFromBody(body: string, max = 140): string {
  const text = body
    .replace(/^#+\s+.+$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Open project with on-chain escrow.";
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function landingHeroHtml(): string {
  return `<section class="landing-hero">
    <div class="landing-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide landing-hero-inner">
      ${networkBadgeHtml()}
      <h1 class="landing-brand">Plebly</h1>
      <p class="landing-title">Fund open Bitcoin work.<br />Protocol over platform.</p>
      <p class="landing-sub">Public escrow anyone can verify. No custodian in the middle.</p>
      ${signetHeroNoteHtml()}
      <div class="landing-cta-row">
        <a class="btn landing-btn" href="${projectsHref()}">Donate to a project</a>
        <a class="btn ghost landing-btn" href="${href("/propose")}">Start a project</a>
      </div>
    </div>
  </section>`;
}

function audiencePathsHtml(): string {
  const paths = [
    {
      kicker: "Creators",
      title: "Name the problem",
      body: "Describe what needs building and what counts as done. Pay the submission fee on-chain, then let the escrow fill in public.",
      href: href("/propose"),
      cta: "Start a project",
    },
    {
      kicker: "Donors",
      title: "Fund the escrow",
      body: "Pick a project and send Bitcoin to its public address. No account required. Balances update from the mempool.",
      href: projectsHref(),
      cta: "Browse projects",
    },
    {
      kicker: "Builders",
      title: "Apply and deliver",
      body: "When escrow clears the claim floor, apply with a bond, win the award, and ship the deliverable. Payment follows public review.",
      href: projectsHref("?for=builders"),
      cta: "See open projects",
    },
  ];
  return `<section class="wrap-wide landing-paths">
    <div class="landing-section-head">
      <h2>The funding loop</h2>
    </div>
    <div class="path-grid">${paths
      .map(
        (p) => `<a class="path-card" href="${p.href}">
        <span class="path-kicker">${escapeHtml(p.kicker)}</span>
        <h3>${escapeHtml(p.title)}</h3>
        <p>${escapeHtml(p.body)}</p>
        <span class="path-cta">${escapeHtml(p.cta)} →</span>
      </a>`,
      )
      .join("")}</div>
  </section>`;
}

type EndowmentTeaser = {
  configured: boolean;
  display_balance_sats: number;
  goal_sats: number;
};

async function fetchEndowmentTeaser(): Promise<EndowmentTeaser | null> {
  if (!WORKERS_API) return null;
  try {
    const res = await fetch(`${WORKERS_API.replace(/\/$/, "")}/endowment`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<EndowmentTeaser>;
    return {
      configured: Boolean(body.configured),
      display_balance_sats: Number(body.display_balance_sats) || 0,
      goal_sats: Math.max(0, Math.floor(Number(body.goal_sats) || 0)),
    };
  } catch {
    return null;
  }
}

function endowmentStripHtml(teaser: EndowmentTeaser | null): string {
  const progress =
    teaser && teaser.configured
      ? endowmentMeterHtml(teaser.display_balance_sats, teaser.goal_sats)
      : "";
  return `<section class="wrap-wide landing-endowment" aria-labelledby="endowment-strip-heading">
    <div class="endowment-strip">
      <div class="endowment-strip-copy">
        <p class="path-kicker">Endowment</p>
        <h2 id="endowment-strip-heading">Shared pool</h2>
        ${progress}
      </div>
      <div class="landing-cta-row endowment-strip-cta">
        <a class="btn" href="${href("/endowment")}?donate">Donate</a>
        <a class="btn ghost" href="${href("/endowment")}#funded">Funded projects</a>
      </div>
    </div>
  </section>`;
}

function howItWorksHtml(): string {
  const steps = [
    { n: "01", title: "Propose", body: "Describe the problem, deliverable, and how success is verified." },
    { n: "02", title: "Donate", body: "Anyone sends sats to the project’s public escrow address." },
    { n: "03", title: "Apply", body: "Builders apply with a bond once funding clears the claim floor." },
    { n: "04", title: "Complete", body: "Reviewers verify the work. Keyholders release escrow in wallet — Plebly never moves funds." },
  ];
  return `<section class="landing-how">
    <div class="wrap-wide">
      <div class="landing-section-head">
        <h2>How it works</h2>
        <p>Four steps. No custody. Full history in the open.</p>
      </div>
      <ol class="how-grid">${steps
        .map(
          (s) => `<li class="how-step">
          <span class="how-n">${s.n}</span>
          <h3>${escapeHtml(s.title)}</h3>
          <p>${escapeHtml(s.body)}</p>
        </li>`,
        )
        .join("")}</ol>
      <p class="landing-how-link"><a href="${href("/about")}">Read the full protocol →</a></p>
    </div>
  </section>`;
}

function trustStripHtml(): string {
  const items = [
    { title: "Non-custodial", body: "Multisig escrow you can verify on-chain" },
    { title: "Uncensorable", body: "Canonical proposals live in a public git repo" },
    { title: "Transparent fees", body: "Parameters published and fixed at launch" },
  ];
  return `<section class="wrap-wide landing-trust">
    <div class="trust-grid">${items
      .map(
        (i) => `<div class="trust-item">
        <h3>${escapeHtml(i.title)}</h3>
        <p>${escapeHtml(i.body)}</p>
      </div>`,
      )
      .join("")}</div>
  </section>`;
}

function gapTickerHtml(
  proposals: Proposal[],
  floor = CLAIM_FLOOR_SATS,
): string {
  const { shortfallSats, projectCount, fundedTowardFloor } = claimFloorShortfall(
    proposals,
    floor,
  );
  if (projectCount === 0) {
    return `<section class="wrap-wide gap-ticker gap-ticker-met">
      <div>
        <span class="gap-ticker-label">Claim floor met</span>
        <span class="gap-ticker-note">Open projects are at or above the claim floor</span>
        <strong>Ready to apply</strong>
      </div>
      <a href="${projectsHref()}">Browse projects →</a>
    </section>`;
  }
  const capacity = fundedTowardFloor + shortfallSats;
  const percent = Math.min(
    100,
    Math.round((fundedTowardFloor / Math.max(1, capacity)) * 100),
  );
  const projectLabel =
    projectCount === 1 ? "1 project" : `${projectCount} projects`;
  return `<section class="wrap-wide gap-ticker">
    <div>
      <span class="gap-ticker-label">Unlock claimable work</span>
      <span class="gap-ticker-note">${escapeHtml(projectLabel)} still below the claim floor</span>
      <strong>${escapeHtml(formatSats(shortfallSats))} <span>to claim floor</span></strong>
    </div>
    <div class="gap-ticker-meter" role="progressbar" aria-label="Progress toward claim floor across underfunded projects" aria-valuemin="0" aria-valuemax="${capacity}" aria-valuenow="${fundedTowardFloor}"><span style="width: ${percent}%"></span></div>
    <a href="${projectsHref("?size=below-floor")}">Fund below-floor projects →</a>
  </section>`;
}

function discoverToolbarHtml(count: number): string {
  return `<div class="discover-toolbar">
    <div class="discover-toolbar-left">
      <h2 id="projects-heading">Open projects</h2>
      <p class="projects-sub"><span id="project-count">${count}</span> live</p>
    </div>
    <div class="discover-controls">
      <label class="discover-search">
        <span class="sr-only">Search projects</span>
        <input id="project-search" type="search" placeholder="Search projects…" autocomplete="off" />
      </label>
      <label class="discover-sort">
        <span class="sr-only">Sort</span>
        <select id="project-sort">
          <option value="funded">Most funded</option>
          <option value="newest">Newest</option>
          <option value="floor">Closest to floor</option>
        </select>
      </label>
      <details class="discover-more">
        <summary>More filters</summary>
        <div class="discover-more-controls">
          <label class="discover-filter">
            <span class="sr-only">Filter by tag</span>
            <select id="project-tag-filter">
              <option value="">All tags</option>
            </select>
          </label>
          <label class="discover-filter">
            <span class="sr-only">Filter by status</span>
            <select id="project-status-filter">
              <option value="">All statuses</option>
            </select>
          </label>
          <label class="discover-filter">
            <span class="sr-only">Filter by funding size</span>
            <select id="project-size-filter">
              <option value="all">Any funding</option>
              <option value="below-floor">Below floor</option>
              <option value="at-floor">Floor met</option>
              <option value="overfunded">Overfunded</option>
            </select>
          </label>
          <label class="discover-filter">
            <span class="sr-only">Filter by time remaining</span>
            <select id="project-window-filter">
              <option value="all">Any window</option>
              <option value="soon">≤30 days left</option>
              <option value="ended">Window ended</option>
            </select>
          </label>
          <div class="builder-filters" aria-label="Claim and type filters">
            <div class="builder-filter-group" role="group" aria-label="Claim state">
              <span class="builder-filter-label">Claim</span>
              <button type="button" class="builder-filter active" data-claim="all">Any</button>
              <button type="button" class="builder-filter" data-claim="open">Open</button>
              <button type="button" class="builder-filter" data-claim="near">Near</button>
              <button type="button" class="builder-filter" data-claim="taken">Taken</button>
            </div>
            <div class="builder-filter-group" role="group" aria-label="Proposal type">
              <span class="builder-filter-label">Type</span>
              <button type="button" class="builder-filter active" data-type="all">Any</button>
              <button type="button" class="builder-filter" data-type="bounty">Bounty</button>
              <button type="button" class="builder-filter" data-type="direct">Direct</button>
            </div>
            <div class="builder-filter-group" role="group" aria-label="Endowment">
              <span class="builder-filter-label">Endowment</span>
              <button type="button" class="builder-filter active" data-endowment="all">Any</button>
              <button type="button" class="builder-filter" data-endowment="funded">Funded</button>
            </div>
          </div>
        </div>
      </details>
    </div>
  </div>`;
}

function progressHtml(p: Proposal, floor: number): string {
  const bal = p.balance_sats ?? 0;
  const remaining = Math.max(0, floor - bal);
  const open = isOpenToClaim(p, floor);
  const near = isNearFloor(p, floor);
  const isDirect = String(p.proposal_type || "bounty").toLowerCase() === "direct";
  const target = fundingTargetSats(p.target_sats);
  // Claim floor is the minimum to start work — "overfunded" only past the soft target.
  const over = isPastFundingTarget(bal, target);
  const overLabel = over && target ? overfundRatioLabel(bal, target) : "";
  const label = over
    ? `Overfunded${overLabel ? ` · ${overLabel}` : ""}`
    : isDirect
      ? bal >= floor
        ? "Floor met · direct"
        : `${formatSats(remaining)} to floor`
      : open
        ? "Open to apply"
        : near
          ? "Near floor"
          : isTakenStatus(String(p.status)) || p.claimer
            ? "Taken"
            : `${formatSats(remaining)} to claim floor`;
  const labelClass = over ? "overfunded" : open || (isDirect && bal >= floor) ? "claimable" : "";
  const satsLine = target
    ? `${formatSats(bal)} · floor ${formatSats(floor)} · target ${formatSats(target)}`
    : `${formatSats(bal)} / ${formatSats(floor)} floor`;
  return `<div class="project-card-meter">
    <div class="project-card-meter-top">
      <span class="${labelClass}">${label}</span>
      <span class="sats">${satsLine}</span>
    </div>
    ${fundingBarTrackHtml(bal, floor, "progress", target)}
  </div>`;
}

/** Public card renderer — also used on `/endowment` funded grid. */
export function proposalCardHtml(
  p: Proposal,
  floor: number,
  lightningEnabled: boolean,
  watching: boolean,
): string {
  const status = String(p.status);
  const proposer = projectCardProposerHtml(p, {
    profileHref,
    orgHref,
    escapeHtml,
    orgAvatarSlotHtml,
  });
  const donateHref = `${proposalHref(p.path, p.id)}?donate`;
  const isDirect = String(p.proposal_type || "bounty").toLowerCase() === "direct";
  const typeBadge = isDirect
    ? `<span class="project-card-type" title="Proposer is the recipient">Direct</span>`
    : "";
  const endowmentBadge = p.endowment_funded
    ? `<a class="project-card-endowment" href="${href("/endowment")}" title="Endowment">Endowment</a>`
    : "";
  const claimModeBadge = claimModeChipHtml(p, floor);
  const secondaryBadge = claimModeBadge
    ? claimModeBadge
    : watching
      ? `<span class="project-card-watch">Watching</span>`
      : lightningEnabled && p.escrow_address
        ? `<span class="project-card-ln" title="Lightning settles into on-chain escrow">Lightning</span>`
        : "";
  const cover = safeHttpsImageUrl(p.cover_image);
  const coverHtml = cover
    ? `<div class="project-card-cover"><img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" /></div>`
    : "";
  const tags = (p.tags || [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
  const tagsHtml = tags.length
    ? `<div class="project-card-tags" aria-label="Tags">${tags
        .map((tag) => `<span class="project-tag">${escapeHtml(tag)}</span>`)
        .join("")}</div>`
    : "";
  const views =
    typeof p.view_count === "number" && p.view_count > 0
      ? `<span class="project-card-views" title="Approximate page views">${p.view_count.toLocaleString()} views</span>`
      : "";
  const rescue = Boolean(p.rescue);
  const rescueHtml = rescue
    ? `<div class="project-card-rescue" role="status"><span>Rescue needed</span>${
        typeof p.rescue_gap_sats === "number"
          ? `<span class="mono">gap: ${formatSats(p.rescue_gap_sats)}</span>`
          : ""
      }</div>`
    : "";
  const watchCount =
    typeof p.watch_count === "number" ? p.watch_count : 0;
  const watchCtrl = p.id
    ? `<button type="button" class="project-card-watch-btn" data-card-watch="${escapeHtml(p.id)}" data-path="${escapeHtml(p.path)}" data-watching="${watching ? "1" : "0"}" aria-label="${watching ? "Unwatch" : "Watch"}" title="${watching ? "Unwatch" : "Watch"}"><span class="project-card-watch-icon" aria-hidden="true">${watching ? "★" : "☆"}</span><span class="mono project-card-watch-count">${watchCount}</span></button>`
    : "";
  return `
    <article class="project-card${rescue ? " is-rescue" : ""}">
      <div class="project-card-head">
        ${statusPillHtml(status)}
        ${typeBadge}
        ${endowmentBadge}
        ${secondaryBadge}
      </div>
      <a class="project-card-main" href="${proposalHref(p.path, p.id)}">
        ${coverHtml}
        <div class="project-card-body">
          ${rescueHtml}
          <h3>${escapeHtml(p.title)}</h3>
          <p class="project-card-excerpt">${escapeHtml(excerptFromBody(p.body))}</p>
          ${tagsHtml}
          ${progressHtml(p, floor)}
          ${views}
        </div>
      </a>
      <div class="project-card-actions">
        ${proposer}
        ${watchCtrl}
        <a class="btn project-donate-btn" href="${donateHref}">Donate</a>
      </div>
    </article>`;
}

function railHtml(
  id: string,
  title: string,
  description: string,
  proposals: Proposal[],
  floor: number,
  lightningEnabled: boolean,
  watchPaths: Set<string>,
  opts: { hideWhenEmpty?: boolean; browseHref?: string } = {},
): string {
  const browse = opts.browseHref || projectsHref();
  if (!proposals.length) {
    if (opts.hideWhenEmpty) return "";
    const emptyBody =
      id === "completed-projects"
        ? "Nothing here yet. Projects move here after public review and release."
        : `No ${title.toLowerCase()} yet.`;
    const emptyBrowse = opts.browseHref
      ? `<a href="${escapeHtml(opts.browseHref)}">Browse archive →</a>`
      : "";
    return `<section class="wrap-wide project-rail project-rail-empty" aria-labelledby="${id}">
      <div class="rail-head">
        <div><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
        ${emptyBrowse}
      </div>
      <div class="rail-empty">
        <p class="rail-empty-line">${escapeHtml(emptyBody)}</p>
      </div>
    </section>`;
  }
  return `<section class="wrap-wide project-rail" aria-labelledby="${id}">
    <div class="rail-head">
      <div><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
      <a href="${escapeHtml(browse)}">Browse all →</a>
    </div>
    <div class="project-rail-list">${proposals
      .map((p) => proposalCardHtml(p, floor, lightningEnabled, watchPaths.has(p.path) || Boolean(p.id && watchPaths.has(p.id))))
      .join("")}</div>
  </section>`;
}

function bottomCtaHtml(): string {
  return `<section class="landing-bottom-cta">
    <div class="wrap-wide landing-bottom-inner">
      <h2>Have a project worth funding?</h2>
      <p>Write a clear deliverable, pay the on-chain submission fee, and list it for donors to support.</p>
      <div class="landing-cta-row">
        <a class="btn" href="${href("/propose")}">Start a project</a>
        <a class="btn ghost" href="${href("/about")}">About Plebly</a>
      </div>
    </div>
  </section>`;
}

async function enrichBalances(proposals: Proposal[]): Promise<Proposal[]> {
  return Promise.all(
    proposals.map(async (p) => {
      if (!p.escrow_address) return p;
      // Catalog blob already includes balances from the Worker cron.
      if (typeof p.balance_sats === "number") return p;
      try {
        const balance_sats = await addressBalanceSats(p.escrow_address);
        return { ...p, balance_sats };
      } catch {
        return p;
      }
    }),
  );
}

function sortProposals(proposals: Proposal[], key: SortKey, floor: number): Proposal[] {
  const list = [...proposals];
  const byKey = (a: Proposal, b: Proposal) => {
    if (key === "funded") return (b.balance_sats ?? 0) - (a.balance_sats ?? 0);
    if (key === "newest")
      return (b.created_at || "").localeCompare(a.created_at || "");
    return (
      Math.max(0, floor - (a.balance_sats ?? 0)) -
      Math.max(0, floor - (b.balance_sats ?? 0))
    );
  };
  list.sort((a, b) => {
    const ar = a.rescue ? 1 : 0;
    const br = b.rescue ? 1 : 0;
    if (ar !== br) return br - ar;
    return byKey(a, b);
  });
  return list;
}

function bindDiscover(
  root: ParentNode,
  proposals: Proposal[],
  floor: number,
  lightningEnabled: boolean,
  watchPaths: Set<string>,
): void {
  const listEl = root.querySelector("#list")!;
  const searchEl = root.querySelector<HTMLInputElement>("#project-search");
  const sortEl = root.querySelector<HTMLSelectElement>("#project-sort");
  const tagEl = root.querySelector<HTMLSelectElement>("#project-tag-filter");
  const statusEl = root.querySelector<HTMLSelectElement>("#project-status-filter");
  const sizeEl = root.querySelector<HTMLSelectElement>("#project-size-filter");
  const windowEl = root.querySelector<HTMLSelectElement>("#project-window-filter");
  const countEl = root.querySelector("#project-count");
  let claimFilter: ClaimFilter = /(?:^|[?&])for=builders(?:&|$)/.test(
    location.search,
  )
    ? "open"
    : "all";
  let typeFilter: TypeFilter = "all";
  let endowmentFilter: "all" | "funded" = /(?:^|[?&])endowment=1(?:&|$)/.test(
    location.search,
  )
    ? "funded"
    : "all";

  const sizeFromUrl = new URLSearchParams(location.search).get("size");
  if (
    sizeEl &&
    (sizeFromUrl === "below-floor" ||
      sizeFromUrl === "at-floor" ||
      sizeFromUrl === "overfunded")
  ) {
    sizeEl.value = sizeFromUrl;
  }

  const populateSelect = (
    select: HTMLSelectElement | null,
    values: string[],
    label: (value: string) => string,
  ) => {
    if (!select) return;
    select.innerHTML = [
      select.options[0]?.outerHTML || "",
      ...values.map(
        (value) =>
          `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`,
      ),
    ].join("");
  };
  populateSelect(
    tagEl,
    [...new Set(proposals.flatMap((p) => p.tags || []))]
      .map((tag) => tag.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    (tag) => tag,
  );
  populateSelect(
    statusEl,
    [...new Set(proposals.map((p) => String(p.status)))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    statusLabel,
  );

  const syncFilterButtons = () => {
    root.querySelectorAll<HTMLButtonElement>("[data-claim]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.claim === claimFilter);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === typeFilter);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-endowment]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.endowment === endowmentFilter);
    });
  };
  root.querySelectorAll<HTMLButtonElement>("[data-claim]").forEach((btn) => {
    btn.addEventListener("click", () => {
      claimFilter = (btn.dataset.claim || "all") as ClaimFilter;
      syncFilterButtons();
      renderList();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      typeFilter = (btn.dataset.type || "all") as TypeFilter;
      syncFilterButtons();
      renderList();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-endowment]").forEach((btn) => {
    btn.addEventListener("click", () => {
      endowmentFilter = (btn.dataset.endowment || "all") as "all" | "funded";
      syncFilterButtons();
      renderList();
    });
  });
  syncFilterButtons();

  const renderList = () => {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const sort = (sortEl?.value || "funded") as SortKey;
    const tag = (tagEl?.value || "").toLowerCase();
    const status = (statusEl?.value || "").toLowerCase();
    const size = (sizeEl?.value || "all") as SizeFilter;
    const window = (windowEl?.value || "all") as WindowFilter;
    let filtered = proposals;
    if (q) {
      filtered = proposals.filter(
        (p) => {
          const searchable = [
            p.title,
            p.body,
            p.status,
            p.proposal_type || "bounty",
            ...(p.tags || []),
          ]
            .join(" ")
            .toLowerCase();
          return searchable.includes(q);
        },
      );
    }
    if (tag) {
      filtered = filtered.filter((p) =>
        (p.tags || []).some((proposalTag) => proposalTag.toLowerCase() === tag),
      );
    }
    if (status) {
      filtered = filtered.filter(
        (p) => String(p.status).toLowerCase() === status,
      );
    }
    if (size === "below-floor") {
      filtered = filtered.filter((p) => (p.balance_sats ?? 0) < floor);
    } else if (size === "at-floor") {
      filtered = filtered.filter((p) => {
        const bal = p.balance_sats ?? 0;
        return bal >= floor && !isPastFundingTarget(bal, p.target_sats);
      });
    } else if (size === "overfunded") {
      filtered = filtered.filter((p) =>
        isPastFundingTarget(p.balance_sats ?? 0, p.target_sats),
      );
    }
    if (window !== "all") {
      const now = Date.now();
      filtered = filtered.filter((p) => {
        const isDirect =
          String(p.proposal_type || "bounty").toLowerCase() === "direct";
        const windowEnd = isDirect
          ? p.delivery_window_ends_at
          : p.funding_window_ends_at;
        const end = windowEnd ? new Date(windowEnd).getTime() : NaN;
        if (Number.isNaN(end)) return false;
        return window === "soon"
          ? end >= now && end <= now + 30 * 86400_000
          : end < now;
      });
    }
    if (claimFilter === "open") {
      filtered = filtered.filter((p) => isOpenToClaim(p, floor));
    } else if (claimFilter === "near") {
      filtered = filtered.filter((p) => isNearFloor(p, floor));
    } else if (claimFilter === "taken") {
      filtered = filtered.filter(
        (p) => isTakenStatus(String(p.status)) || Boolean(p.claimer),
      );
    }
    if (typeFilter === "bounty") {
      filtered = filtered.filter(
        (p) => String(p.proposal_type || "bounty").toLowerCase() !== "direct",
      );
    } else if (typeFilter === "direct") {
      filtered = filtered.filter(
        (p) => String(p.proposal_type || "bounty").toLowerCase() === "direct",
      );
    }
    if (endowmentFilter === "funded") {
      filtered = filtered.filter((p) => Boolean(p.endowment_funded));
    }
    filtered = sortProposals(filtered, sort, floor);
    if (countEl) countEl.textContent = String(filtered.length);
    if (filtered.length === 0) {
      listEl.className = "empty-state";
      listEl.innerHTML = `<div class="empty-state-inner">
        <p class="empty-state-title">No matching projects</p>
        <p class="empty-state-body">Try another search, or start something new.</p>
        <a class="btn" href="${href("/propose")}">Start a project</a>
      </div>`;
      return;
    }
    listEl.className = "project-grid";
    listEl.innerHTML = filtered
      .map((p) =>
        proposalCardHtml(
          p,
          floor,
          lightningEnabled,
          watchPaths.has(p.path) ||
            watchPaths.has(p.id || "") ||
            Boolean(p.id && watchPaths.has(p.id)),
        ),
      )
      .join("");
    bindCardWatches(listEl, watchPaths);
  };

  const scheduleAvatars = () => {
    void hydrateAvatarSlots(root);
  };
  searchEl?.addEventListener("input", () => {
    renderList();
    scheduleAvatars();
  });
  sortEl?.addEventListener("change", () => {
    renderList();
    scheduleAvatars();
  });
  tagEl?.addEventListener("change", () => {
    renderList();
    scheduleAvatars();
  });
  statusEl?.addEventListener("change", () => {
    renderList();
    scheduleAvatars();
  });
  sizeEl?.addEventListener("change", () => {
    renderList();
    scheduleAvatars();
  });
  windowEl?.addEventListener("change", () => {
    renderList();
    scheduleAvatars();
  });
  renderList();
  scheduleAvatars();
}

export function bindCardWatches(root: ParentNode, watchPaths: Set<string>): void {
  root.querySelectorAll<HTMLButtonElement>("[data-card-watch]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.dataset.cardWatch || "";
      const path = btn.dataset.path || id;
      const watching = btn.dataset.watching === "1";
      try {
        if (watching) {
          await removeWatch(path);
          btn.dataset.watching = "0";
          watchPaths.delete(path);
          watchPaths.delete(id);
        } else {
          await addWatch(path);
          btn.dataset.watching = "1";
          watchPaths.add(path);
          if (id) watchPaths.add(id);
        }
        const icon = btn.querySelector(".project-card-watch-icon");
        if (icon) icon.textContent = btn.dataset.watching === "1" ? "★" : "☆";
        const countEl = btn.querySelector(".project-card-watch-count");
        if (countEl) {
          const n = Number(countEl.textContent || "0") || 0;
          countEl.textContent = String(
            Math.max(0, n + (btn.dataset.watching === "1" ? 1 : -1)),
          );
        }
        btn.setAttribute(
          "aria-label",
          btn.dataset.watching === "1" ? "Unwatch" : "Watch",
        );
      } catch {
        /* login required or network — leave UI */
      }
    });
  });
}

function wantedRailHtml(
  rows: Awaited<ReturnType<typeof fetchWanted>>,
): string {
  if (!rows.length) return "";
  return `<section class="wrap-wide project-rail" aria-labelledby="wanted-projects">
    <div class="rail-head">
      <div><h2 id="wanted-projects">Most wanted</h2><p>High watch interest relative to funding progress.</p></div>
      <a href="${href("/wanted")}">Full list →</a>
    </div>
    <div class="wanted-list">${rows
      .slice(0, 4)
      .map(
        (r) => `<a class="wanted-row" href="${proposalHref(r.path, r.id)}">
        <span class="wanted-title">${escapeHtml(r.title)}</span>
        <span class="wanted-nums mono">${r.watches} watches · ${r.weighted} weighted · ${
          r.funded_pct != null ? `${r.funded_pct}%` : "—"
        }</span>
      </a>`,
      )
      .join("")}</div>
  </section>`;
}

export async function renderHome(shell: HomeShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    ${landingHeroHtml()}
    <div id="gap-ticker"></div>
    <section id="activity-strip" class="wrap-wide activity-strip" hidden aria-label="Recent activity"></section>
    ${audiencePathsHtml()}
    <div id="endowment-strip">${endowmentStripHtml(null)}</div>
    <div id="wanted-rail"></div>
    <div id="featured-rail"></div>
    <div id="completed-rail"></div>
    <section class="wrap-wide landing-discover" id="projects" aria-labelledby="projects-heading">
      ${discoverToolbarHtml(0)}
      <div id="list" class="project-grid project-grid-skeleton" aria-busy="true" aria-label="Loading open projects">
        <div class="project-card skeleton-card"></div>
        <div class="project-card skeleton-card"></div>
        <div class="project-card skeleton-card"></div>
        <div class="project-card skeleton-card"></div>
      </div>
    </section>
    ${howItWorksHtml()}
    ${trustStripHtml()}
    ${bottomCtaHtml()}
  `);

  const listEl = app.querySelector("#list")!;
  try {
    let proposals = await listListedProposals();
    const [withBalances, lnStatus, watches, endowmentTeaser] = await Promise.all([
      enrichBalances(proposals),
      lightningUiAllowed()
        ? fetchLightningStatus()
        : Promise.resolve({ enabled: false }),
      fetchWatches().catch(() => []),
      fetchEndowmentTeaser(),
    ]);
    proposals = withBalances;
    const endowmentStrip = app.querySelector("#endowment-strip");
    if (endowmentStrip) endowmentStrip.innerHTML = endowmentStripHtml(endowmentTeaser);
    const viewCounts = await fetchProposalViewsBatch(
      proposals.map((proposal) => proposal.id || "").filter(Boolean),
    ).catch(() => new Map<string, number>());
    const watchKeys = [
      ...new Set(
        proposals.flatMap((p) =>
          [watchStorageId(p.path), p.id || ""].filter(Boolean),
        ),
      ),
    ];
    const watchMeta = await fetchWatchMetaBatch(watchKeys).catch(
      (): Record<string, { count: number; weighted: number }> => ({}),
    );
    proposals = proposals.map((proposal) => {
      const view_count = proposal.id ? viewCounts.get(proposal.id) : undefined;
      const slug = watchStorageId(proposal.path);
      const meta =
        (slug && watchMeta[slug]) ||
        (proposal.id ? watchMeta[proposal.id] : undefined);
      return {
        ...proposal,
        ...(typeof view_count === "number" ? { view_count } : {}),
        ...(meta ? { watch_count: meta.count } : {}),
      };
    });
    const lightningEnabled = Boolean(lnStatus.enabled);
    const watchPaths = new Set(
      watches.flatMap((w) => [w.proposal_path, w.proposal_id]),
    );
    const wanted = await fetchWanted(8).catch(() => []);
    const wantedRail = app.querySelector("#wanted-rail");
    if (wantedRail) wantedRail.innerHTML = wantedRailHtml(wanted);
    const pinned = new Set<string>(); // Ops may populate this later from public config.
    const excluded = new Set<string>();
    const featured = proposals
      .filter(
        (proposal) =>
          String(proposal.status) !== "completed" &&
          !excluded.has(proposal.id || ""),
      )
      .sort((a, b) => {
        const aPinned = pinned.has(a.id || "") ? 1 : 0;
        const bPinned = pinned.has(b.id || "") ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        const aScore =
          -Math.abs(CLAIM_FLOOR_SATS - (a.balance_sats ?? 0)) +
          (a.view_count ?? 0) * 100;
        const bScore =
          -Math.abs(CLAIM_FLOOR_SATS - (b.balance_sats ?? 0)) +
          (b.view_count ?? 0) * 100;
        return bScore - aScore;
      })
      .slice(0, 4);
    const completed = proposals
      .filter((proposal) => String(proposal.status) === "completed")
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 4);
    const gapTicker = app.querySelector("#gap-ticker");
    if (gapTicker) gapTicker.innerHTML = gapTickerHtml(proposals, CLAIM_FLOOR_SATS);
    void bindActivityStrip(app);
    const featuredRail = app.querySelector("#featured-rail");
    if (featuredRail) {
      featuredRail.innerHTML = railHtml(
        "featured-projects",
        "Featured work",
        "Near the claim floor and drawing attention.",
        featured,
        CLAIM_FLOOR_SATS,
        lightningEnabled,
        watchPaths,
        { hideWhenEmpty: true },
      );
      bindCardWatches(featuredRail, watchPaths);
    }
    const completedRail = app.querySelector("#completed-rail");
    if (completedRail) {
      completedRail.innerHTML = railHtml(
        "completed-projects",
        "Recently completed",
        "Work delivered through public review.",
        completed,
        CLAIM_FLOOR_SATS,
        lightningEnabled,
        watchPaths,
        { hideWhenEmpty: true, browseHref: href("/completed") },
      );
      bindCardWatches(completedRail, watchPaths);
    }
    if (proposals.length === 0) {
      listEl.className = "empty-state";
      listEl.innerHTML = `<div class="empty-state-inner">
        <p class="empty-state-title">No open projects yet</p>
        <p class="empty-state-body">Be the first to list funded work in the open repo.</p>
        <a class="btn" href="${href("/propose")}">Start a project</a>
      </div>`;
      return;
    }
    bindDiscover(app, proposals, CLAIM_FLOOR_SATS, lightningEnabled, watchPaths);
    void hydrateAvatarSlots(app);
    const chipTimer = window.setInterval(
      () => refreshClaimModeChips(app),
      60_000,
    );
    const onHomeFocus = () => {
      if (document.visibilityState === "hidden") return;
      refreshClaimModeChips(app);
    };
    document.addEventListener("visibilitychange", onHomeFocus);
    window.addEventListener("focus", onHomeFocus);
    const stopHomeLive = () => {
      window.clearInterval(chipTimer);
      document.removeEventListener("visibilitychange", onHomeFocus);
      window.removeEventListener("focus", onHomeFocus);
    };
    const homeObs = new MutationObserver(() => {
      if (!document.contains(app) || !app.querySelector("#list")) {
        stopHomeLive();
        homeObs.disconnect();
      }
    });
    homeObs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    listEl.className = "error";
    listEl.textContent = `Could not load projects: ${(e as Error).message}`;
  }
}
