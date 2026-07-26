import {
  fetchWatches,
  isNearFloor,
  isOpenToClaim,
  isTakenStatus,
} from "./builder";
import {
  BITCOIN_NETWORK,
  CLAIM_FLOOR_SATS,
  CORE_ANNUAL_GAP_SATS,
  lightningUiAllowed,
} from "./config";
import { listListedProposals } from "./github";
import { fetchLightningStatus } from "./lightning";
import { safeHttpsImageUrl } from "./media";
import { addressBalanceSats } from "./mempool";
import {
  fundingBarTrackHtml,
  overfundRatioLabel,
  statusLabel,
  statusPillHtml,
} from "./proposal-ui";
import type { Proposal } from "./types";
import { href, profileHref, proposalHref } from "./router";
import { hydrateAvatarSlots } from "./profile-avatars";
import { escapeHtml, formatSats } from "./util";
import { fetchProposalViews } from "./views";
import { bindActivityStrip } from "./activity";

export type HomeShell = (inner: string) => string;

type SortKey = "funded" | "newest" | "floor";
type ClaimFilter = "all" | "open" | "near" | "taken";
type TypeFilter = "all" | "bounty" | "direct";
type SizeFilter = "all" | "below-floor" | "at-floor" | "overfunded";
type WindowFilter = "all" | "soon" | "ended";

function networkBadgeHtml(): string {
  const isSignet = BITCOIN_NETWORK === "signet";
  return `<span class="network-badge ${isSignet ? "network-badge-test" : ""}">${isSignet ? "Signet · testing" : "Mainnet"}</span>`;
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
      <div class="landing-cta-row">
        <a class="btn landing-btn" href="${href("/", "", "#projects")}">Donate to a project</a>
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
      href: href("/", "", "#projects"),
      cta: "Browse projects",
    },
    {
      kicker: "Builders",
      title: "Claim and deliver",
      body: "When escrow clears the claim floor, claim the work and ship the deliverable. Payment follows public review.",
      href: href("/", "?for=builders", "#projects"),
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

function howItWorksHtml(): string {
  const steps = [
    { n: "01", title: "Propose", body: "Describe the problem, deliverable, and how success is verified." },
    { n: "02", title: "Donate", body: "Anyone sends sats to the project’s public escrow address." },
    { n: "03", title: "Claim", body: "A builder claims once funding clears the claim floor." },
    { n: "04", title: "Complete", body: "Reviewers verify the work; keyholders release escrow on success." },
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

function gapTickerHtml(escrowed: number): string {
  if (!CORE_ANNUAL_GAP_SATS) return "";
  const percent = Math.min(
    100,
    Math.round((escrowed / Math.max(1, CORE_ANNUAL_GAP_SATS)) * 100),
  );
  return `<section class="wrap-wide gap-ticker">
    <div>
      <span class="gap-ticker-label">Fund the core gap</span>
      <span class="gap-ticker-note">Escrowed across open projects vs published Core annual gap</span>
      <strong>${formatSats(escrowed)} <span>of ${formatSats(CORE_ANNUAL_GAP_SATS)}</span></strong>
    </div>
    <div class="gap-ticker-meter" role="progressbar" aria-label="Core annual gap funded" aria-valuemin="0" aria-valuemax="${CORE_ANNUAL_GAP_SATS}" aria-valuenow="${escrowed}"><span style="width: ${percent}%"></span></div>
    <a href="${href("/stats")}">${percent}% tracked →</a>
  </section>`;
}

function discoverToolbarHtml(count: number): string {
  return `<div class="discover-toolbar">
    <div class="discover-toolbar-left">
      <h2 id="projects">Open projects</h2>
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
        </div>
      </details>
    </div>
  </div>
  <div class="builder-filters" aria-label="Project filters">
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
  </div>`;
}

function progressHtml(p: Proposal, floor: number): string {
  const bal = p.balance_sats ?? 0;
  const pct = Math.min(100, Math.round((bal / Math.max(1, floor)) * 100));
  const open = isOpenToClaim(p, floor);
  const near = isNearFloor(p, floor);
  const over = bal > floor;
  const overLabel = overfundRatioLabel(bal, floor);
  const isDirect = String(p.proposal_type || "bounty").toLowerCase() === "direct";
  const label = over
    ? `Overfunded · ${overLabel}`
    : isDirect
      ? bal >= floor
        ? "Floor met · direct"
        : `${pct}% to floor`
      : open
        ? "Open to claim"
        : near
          ? "Near floor"
          : isTakenStatus(String(p.status)) || p.claimer
            ? "Taken"
            : `${pct}% to claim floor`;
  const labelClass = over ? "overfunded" : open ? "claimable" : "";
  return `<div class="project-card-meter">
    <div class="project-card-meter-top">
      <span class="${labelClass}">${label}</span>
      <span class="sats">${formatSats(bal)} / ${formatSats(floor)}</span>
    </div>
    ${fundingBarTrackHtml(bal, floor, "progress")}
  </div>`;
}

function proposalCardHtml(
  p: Proposal,
  floor: number,
  lightningEnabled: boolean,
  watching: boolean,
): string {
  const status = String(p.status);
  const proposerName = p.proposer?.username || p.proposer?.github || "";
  const proposerUsername = p.proposer?.username?.trim().toLowerCase() || "";
  const proposerAvatar = proposerUsername
    ? `<span class="user-avatar-slot" data-avatar-user="${escapeHtml(proposerUsername)}" hidden></span>`
    : "";
  const proposer = proposerName
    ? p.proposer?.username
      ? `<a class="project-card-by" href="${profileHref(p.proposer.username)}">${proposerAvatar}<span class="project-card-by-text">by ${escapeHtml(proposerName)}</span></a>`
      : `<span class="project-card-by"><span class="project-card-by-text">by ${escapeHtml(proposerName)}</span></span>`
    : "";
  const donateHref = `${proposalHref(p.path, p.id)}?donate`;
  const open = isOpenToClaim(p, floor);
  const isDirect = String(p.proposal_type || "bounty").toLowerCase() === "direct";
  const typeBadge = isDirect
    ? `<span class="project-card-type" title="Proposer is the recipient">Direct</span>`
    : "";
  const secondaryBadge = open
    ? `<span class="project-card-open" title="Confirmed funding meets claim floor">Open to claim</span>`
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
  return `
    <article class="project-card">
      <a class="project-card-main" href="${proposalHref(p.path, p.id)}">
        ${coverHtml}
        <div class="project-card-body">
          <div class="project-card-head">
            ${statusPillHtml(status)}
            ${typeBadge}
            ${secondaryBadge}
          </div>
          <h3>${escapeHtml(p.title)}</h3>
          <p class="project-card-excerpt">${escapeHtml(excerptFromBody(p.body))}</p>
          ${tagsHtml}
          ${progressHtml(p, floor)}
          ${views}
        </div>
      </a>
      <div class="project-card-actions">
        ${proposer}
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
  opts: { hideWhenEmpty?: boolean } = {},
): string {
  if (!proposals.length) {
    if (opts.hideWhenEmpty) return "";
    const emptyBody =
      id === "completed-projects"
        ? "Nothing here yet. Projects move here after public review and release."
        : `No ${title.toLowerCase()} yet.`;
    return `<section class="wrap-wide project-rail project-rail-empty" aria-labelledby="${id}">
      <div class="rail-head">
        <div><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
      </div>
      <div class="rail-empty">
        <p class="rail-empty-line">${escapeHtml(emptyBody)}</p>
      </div>
    </section>`;
  }
  return `<section class="wrap-wide project-rail" aria-labelledby="${id}">
    <div class="rail-head">
      <div><h2 id="${id}">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
      <a href="${href("/", "", "#projects")}">Browse all →</a>
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
  if (key === "funded") {
    list.sort((a, b) => (b.balance_sats ?? 0) - (a.balance_sats ?? 0));
  } else if (key === "newest") {
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  } else {
    list.sort(
      (a, b) =>
        Math.max(0, floor - (a.balance_sats ?? 0)) -
        Math.max(0, floor - (b.balance_sats ?? 0)),
    );
  }
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
      filtered = filtered.filter((p) => (p.balance_sats ?? 0) >= floor);
    } else if (size === "overfunded") {
      filtered = filtered.filter((p) => (p.balance_sats ?? 0) > floor);
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

export async function renderHome(shell: HomeShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    ${landingHeroHtml()}
    <div id="gap-ticker"></div>
    <section id="activity-strip" class="wrap-wide activity-strip" hidden aria-label="Recent activity"></section>
    ${audiencePathsHtml()}
    <div id="featured-rail"></div>
    <div id="completed-rail"></div>
    <section class="wrap-wide landing-discover">
      ${discoverToolbarHtml(0)}
      <div id="list" class="loading">Loading open projects…</div>
    </section>
    ${howItWorksHtml()}
    ${trustStripHtml()}
    ${bottomCtaHtml()}
  `);

  const listEl = app.querySelector("#list")!;
  try {
    let proposals = await listListedProposals();
    const [withBalances, lnStatus, watches] = await Promise.all([
      enrichBalances(proposals),
      lightningUiAllowed()
        ? fetchLightningStatus()
        : Promise.resolve({ enabled: false }),
      fetchWatches().catch(() => []),
    ]);
    proposals = withBalances;
    const proposalsWithViews = await Promise.all(
      proposals.map(async (proposal) => {
        const view_count = proposal.id
          ? await fetchProposalViews(proposal.id).catch(() => null)
          : null;
        return typeof view_count === "number"
          ? { ...proposal, view_count }
          : proposal;
      }),
    );
    proposals = proposalsWithViews;
    const lightningEnabled = Boolean(lnStatus.enabled);
    const watchPaths = new Set(
      watches.flatMap((w) => [w.proposal_path, w.proposal_id]),
    );
    const escrowed = proposals.reduce(
      (sum, proposal) => sum + (proposal.balance_sats ?? 0),
      0,
    );
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
    if (gapTicker) gapTicker.innerHTML = gapTickerHtml(escrowed);
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
        { hideWhenEmpty: true },
      );
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
  } catch (e) {
    listEl.className = "error";
    listEl.textContent = `Could not load projects: ${(e as Error).message}`;
  }
}
