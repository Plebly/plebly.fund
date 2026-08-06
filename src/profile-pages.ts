import {
  claimUsername,
  deleteAccount,
  fetchPublicProfile,
  fetchNotifications,
  loginChoicesHtml,
  startGithubOrgLink,
  markNotificationsRead,
  peekUnreadNotificationCount,
  profilePath,
  unlinkGithubOrg,
  updateNavUnreadBadge,
  updateProfile,
  accountNavLabel,
  shortNostrPubkey,
  type AuthUser,
  type ProposalNotification,
} from "./auth";
import { CLAIM_FLOOR_SATS } from "./config";
import {
  fetchMyClaims,
  fetchWatches,
  isOpenToClaim,
  type ClaimLedgerView,
} from "./builder";
import {
  applyCreditPreferencesToFields,
  bindCreditPreferenceGates,
  creditPreferenceFieldsHtml,
  loadStoredCreditPreferences,
  readCreditPreferences,
  saveStoredCreditPreferences,
  syncStoredCreditPreferencesFromProfile,
} from "./funder-credit";
import { nostrAccountLink, socialAccountLink } from "./icons";
import { fetchReviewerMe } from "./reviewers";
import {
  listAllPublicProposals,
  listListedProposals,
  proposalsForProfile,
} from "./github";
import { addressBalanceSats } from "./mempool";
import {
  MAX_SKILLS_TAGS,
  SKILLS_PRESET_TAGS,
  SUGGESTED_SKILLS_TAGS,
} from "./skills-tags";
import { isKnownSocialUrl, profileLinksListHtml } from "./social-links";
import { bindTagInput, tagInputHtml } from "./tag-input";
import type { ProfileLink, Proposal } from "./types";
import {
  applySeo,
  href,
  navigate,
  proposalHref,
  seoForRoute,
} from "./router";
import { escapeHtml, formatSats } from "./util";

export type ShellContext = {
  user: AuthUser | null;
  routeName: string;
  shell: (inner: string) => string;
  rerender: () => void;
  /** Keep the top-nav unread badge in sync after mark-read actions. */
  setUnreadNotifications?: (count: number) => void;
};

type AccountTab = "profile" | "watching" | "claims" | "proposals" | "notifications";

function notificationLabel(type: string): string {
  const labels: Record<string, string> = {
    listed: "Project listed",
    floor_reached: "Claim floor reached",
    target_reached: "Funding target reached",
    claimed: "Project claimed",
    claim_application: "Bonded applicant",
    claim_application_awarded: "Claim awarded to you",
    claim_application_rejected: "Application rejected",
    claim_application_lost: "Another applicant won",
    claim_window_grace: "Pick an applicant (grace)",
    claim_auto_awarded: "Auto-awarded earliest bond",
    checkpoint_submitted: "Checkpoint submitted",
    deliverable_submitted: "Deliverable submitted",
    completed: "Project completed",
  };
  return labels[type] || type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function claimsPaneHtml(
  pending: {
    proposal_id: string;
    proposal_path: string;
    pr_url?: string;
    claim_bond_txid?: string;
  }[],
  ledger: ClaimLedgerView | null,
): string {
  const summary = ledger?.summary;
  const summaryHtml = summary
    ? `<div class="claim-summary">
        <span class="pill">Active ${summary.active}</span>
        <span class="pill">Completed ${summary.completed}</span>
        <span class="pill">Expired ${summary.expired}</span>
        <span class="pill">Abandoned ${summary.abandoned}</span>
        <span class="pill">Rejected ${summary.rejected}</span>
        ${
          ledger
            ? `<span class="pill">Next bond ${formatSats(ledger.required_bond_sats)}</span>`
            : ""
        }
      </div>`
    : "";

  const hasAny =
    pending.length > 0 ||
    Boolean(ledger?.bonds?.length) ||
    Boolean(ledger?.cooldowns?.length) ||
    Boolean(summary && (summary.active || summary.completed || summary.expired || summary.abandoned || summary.rejected));

  if (!hasAny) {
    return `<div class="empty-state"><div class="empty-state-inner">
      <p class="empty-state-title">No claims yet</p>
      <p class="empty-state-body">When escrow hits the claim floor, claim a project from its page.</p>
      <a class="btn" href="${href("/")}">Browse projects</a>
    </div></div>`;
  }

  const pendingHtml =
    pending.length === 0
      ? ""
      : `<h3 class="section-title">Pending</h3><ul class="work-list">${pending
          .map(
            (c) => `<li>
              <a href="${proposalHref(c.proposal_path, c.proposal_id)}">${escapeHtml(c.proposal_id)}</a>
              <span class="pill">Pending</span>
              ${
                c.claim_bond_txid
                  ? `<span class="mono muted">${escapeHtml(c.claim_bond_txid.slice(0, 10))}…</span>`
                  : ""
              }
              ${
                c.pr_url
                  ? `<a href="${escapeHtml(c.pr_url)}" target="_blank" rel="noreferrer">PR</a>`
                  : ""
              }
            </li>`,
          )
          .join("")}</ul>`;

  const bonds = ledger?.bonds?.length
    ? `<h3 class="section-title">Bonds</h3><ul class="work-list">${ledger.bonds
        .slice(0, 20)
        .map(
          (b) => `<li>
            <a href="${proposalHref(`proposals/listed/${b.proposal_id}.md`, b.proposal_id)}">${escapeHtml(b.proposal_id)}</a>
            <span class="pill">${escapeHtml(b.status)}</span>
            <span class="mono muted">${escapeHtml(b.txid.slice(0, 10))}… · ${formatSats(b.amount_sats)}</span>
          </li>`,
        )
        .join("")}</ul>`
    : "";

  const cooldowns = ledger?.cooldowns?.length
    ? `<h3 class="section-title">Cooldowns</h3><ul class="work-list">${ledger.cooldowns
        .slice(0, 20)
        .map(
          (c) => `<li>
            <span>${escapeHtml(c.proposal_id)}</span>
            <span class="pill">${escapeHtml(c.reason)}</span>
            <span class="muted">until ${escapeHtml(new Date(c.until).toLocaleDateString())}</span>
          </li>`,
        )
        .join("")}</ul>`
    : "";

  const history = ledger?.history?.length
    ? `<h3 class="section-title">History</h3><ul class="work-list">${ledger.history
        .slice(0, 20)
        .map(
          (h) => `<li>
            <a href="${proposalHref(`proposals/claimed/${h.proposal_id}.md`, h.proposal_id)}">${escapeHtml(h.proposal_id)}</a>
            <span class="pill">${escapeHtml(h.outcome)}</span>
            <span class="muted">${escapeHtml(new Date(h.at).toLocaleDateString())}</span>
          </li>`,
        )
        .join("")}</ul>`
    : "";

  return `${summaryHtml}
    ${pendingHtml}
    ${bonds}
    ${cooldowns}
    ${history}`;
}

function linkRowHtml(links: ProfileLink[]): string {
  return links
    .map(
      (l, i) => `
    <div class="link-row" data-index="${i}">
      <input type="text" class="link-label" placeholder="Label" value="${escapeHtml(l.label)}" maxlength="40" aria-label="Link label" />
      <input type="text" class="link-url mono" inputmode="url" placeholder="https://…" value="${escapeHtml(l.url)}" maxlength="300" aria-label="Link URL" />
      <button type="button" class="editor-remove remove-link">Remove</button>
    </div>`,
    )
    .join("");
}

function identityPanelHtml(user: AuthUser): string {
  const links: string[] = [];
  if (user.github) {
    links.push(
      socialAccountLink(
        "github",
        `https://github.com/${user.github}`,
        user.github,
      ),
    );
  }
  if (user.nostr) {
    links.push(nostrAccountLink(user.nostr, shortNostrPubkey(user.nostr)));
  }
  if (user.x) {
    links.push(
      socialAccountLink("x-twitter", `https://x.com/${user.x.replace(/^@/, "")}`, user.x),
    );
  }
  if (!links.length) return "";
  return `<div class="identity-panel">
        <p class="hint identity-panel-label">Signed in with</p>
        <div class="social-row identity-links">
          ${links.join("")}
        </div>
      </div>`;
}

const ORG_ATTESTATION_MS = 90 * 86_400_000;

function linkedOrgsPanelHtml(user: AuthUser): string {
  if (!user.id.startsWith("github:") || !user.github) {
    return `<div class="identity-panel account-orgs">
      <p class="hint identity-panel-label">GitHub orgs for claims</p>
      <p class="hint">Sign in with GitHub to link orgs you admin. Org claims are not available for Nostr/X-only sessions.</p>
    </div>`;
  }
  const now = Date.now();
  const rows = (user.github_orgs || [])
    .map((o) => {
      const at = Date.parse(o.verified_at);
      const fresh = Number.isFinite(at) && now - at <= ORG_ATTESTATION_MS;
      const when = Number.isFinite(at)
        ? new Date(at).toISOString().slice(0, 10)
        : "?";
      return `<li class="account-org-row">
        <span><strong>@${escapeHtml(o.login)}</strong>
          <span class="muted mono">${fresh ? `admin · verified ${when}` : "stale — link again"}</span>
        </span>
        <button type="button" class="btn ghost" data-unlink-org="${escapeHtml(o.login)}">Unlink</button>
      </li>`;
    })
    .join("");
  return `<div class="identity-panel account-orgs">
      <p class="hint identity-panel-label">GitHub orgs for claims</p>
      <p class="hint">Link orgs you admin (one-time GitHub <code>read:org</code>). Apply-as-org on bounties only offers linked orgs. Re-link every 90 days.</p>
      ${
        rows
          ? `<ul class="account-org-list">${rows}</ul>`
          : `<p class="hint muted">No orgs linked yet.</p>`
      }
      <p class="form-msg" id="org-link-msg" hidden></p>
      <button type="button" class="btn" id="link-github-orgs-btn">Link GitHub orgs</button>
    </div>`;
}

export async function renderAccount(
  ctx: ShellContext,
  initialTab?: AccountTab,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const loginReturn = "/account";
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Account</h1>
        <p class="lede">Sign in to watch projects, claim funded work, and manage your profile.</p>
        ${loginChoicesHtml(undefined, loginReturn)}
      </section>
    `);
    return;
  }

  const user = ctx.user;
  const tab: AccountTab = initialTab || "profile";
  const needsCatalog = tab === "watching" || tab === "proposals";
  // Only pull the full notification list when that tab is open — badge uses cache.
  const needsNotifications = tab === "notifications";
  const [watches, myClaims, allProps, reviewerMe, notifications] = await Promise.all([
    fetchWatches().catch(() => []),
    fetchMyClaims().catch(() => ({ pending: [], ledger: null })),
    needsCatalog
      ? listListedProposals().catch(() => [] as Proposal[])
      : Promise.resolve([] as Proposal[]),
    fetchReviewerMe().catch(() => null),
    needsNotifications
      ? fetchNotifications().catch(() => [] as ProposalNotification[])
      : Promise.resolve([] as ProposalNotification[]),
  ]);
  const cachedUnread = peekUnreadNotificationCount() ?? 0;
  const pendingClaims = myClaims.pending;
  const ledger = myClaims.ledger;
  const byPath = new Map(allProps.map((p) => [p.path, p]));
  const watchRows = await Promise.all(
    watches.map(async (w) => {
      let p = byPath.get(w.proposal_path);
      if (!p) {
        p = allProps.find((x) => x.id === w.proposal_id);
      }
      let bal = p?.balance_sats;
      if (p?.escrow_address && bal == null) {
        try {
          bal = await addressBalanceSats(p.escrow_address);
        } catch {
          /* ignore */
        }
      }
      return { w, p, bal };
    }),
  );
  const myProposals = proposalsForProfile(allProps, user);
  const creditPrefs =
    syncStoredCreditPreferencesFromProfile(user.funder_credit) ||
    loadStoredCreditPreferences() || {
      public_credit: true,
      anonymous: false,
      show_amount: false,
    };

  app.innerHTML = ctx.shell(`
    <section class="wrap-wide detail account-page">
      <div class="account-head">
        <div>
          <h1>${escapeHtml(accountNavLabel(user))}</h1>
          ${
            reviewerMe?.active
              ? `<p class="reviewer-badge"><span class="pill status-good">Active reviewer</span> <span class="muted">${escapeHtml(reviewerMe.reviewer?.kind || "earned")} seat</span> <a href="${href("/reviewers")}">Open governance</a></p>`
              : reviewerMe?.funder_eligible
                ? `<p class="reviewer-badge"><span class="pill status-good">Eligible funder</span> <a href="${href("/reviewers")}#removals">Removal ballots</a></p>`
                : `<p class="reviewer-badge muted"><a href="${href("/reviewers")}">Reviewer governance</a></p>`
          }
          ${user.username ? "" : `<p class="lede">Claim a username for your public profile URL.</p>`}
        </div>
        ${
          user.username
            ? `<a class="btn ghost" href="${profilePath(user.username)}">View profile</a>`
            : ""
        }
      </div>

      <div class="account-tabs" role="tablist">
        <button type="button" class="account-tab ${tab === "profile" ? "active" : ""}" data-tab="profile">Profile</button>
        <button type="button" class="account-tab ${tab === "watching" ? "active" : ""}" data-tab="watching">Watching</button>
        <button type="button" class="account-tab ${tab === "claims" ? "active" : ""}" data-tab="claims">Claims</button>
        <button type="button" class="account-tab ${tab === "proposals" ? "active" : ""}" data-tab="proposals">Proposals</button>
        <button type="button" class="account-tab ${tab === "notifications" ? "active" : ""}" data-tab="notifications">Notifications${
          (needsNotifications
            ? notifications.filter((n) => !n.read_at).length
            : cachedUnread) > 0
            ? ` <span class="account-tab-count">${
                needsNotifications
                  ? notifications.filter((n) => !n.read_at).length
                  : cachedUnread
              }</span>`
            : ""
        }</button>
      </div>

      <div class="account-pane" data-pane="profile" ${tab === "profile" ? "" : "hidden"}>
      <form id="account-form" class="form-panel form-panel-wide account-form">
        <fieldset class="form-block account-block-narrow">
          <legend>Username</legend>
          <div class="field-row">
            <span class="field-prefix">plebly.fund/u/</span>
            <input id="username-input" type="text" value="${escapeHtml(user.username || "")}" placeholder="yourname" pattern="[a-z0-9-]+" minlength="3" maxlength="32" ${user.username ? "readonly" : ""} />
            ${user.username ? "" : `<button type="button" class="btn" id="claim-username-btn">Claim</button>`}
          </div>
          <p class="hint" id="username-hint">3-32 characters · lowercase letters, numbers, hyphens</p>
        </fieldset>

        <fieldset class="form-block account-block-bio">
          <legend>Bio</legend>
          <textarea id="bio-input" rows="4" maxlength="500" placeholder="What you work on, Bitcoin interests…">${escapeHtml(user.bio || "")}</textarea>
        </fieldset>

        <fieldset class="form-block account-block-skills">
          <legend>Skills &amp; interests</legend>
          ${tagInputHtml({
            id: "skills-tags",
            name: "skills_tags",
            tags: user.skills_tags || [],
            max: MAX_SKILLS_TAGS,
            vocabulary: SUGGESTED_SKILLS_TAGS,
            presets: SKILLS_PRESET_TAGS,
            placeholder: "Type a skill, then Enter",
            hint: "Add skills and interests. Matching listed projects may notify you. Up to 20; freeform tags are fine.",
          })}
        </fieldset>

        <fieldset class="form-block account-block-payout">
          <legend>Payout address</legend>
          <input id="payout-input" class="mono" type="text" value="${escapeHtml(user.payout_address || "")}" placeholder="bc1… or tb1…" maxlength="120" />
          <p class="hint">Default for claims; overrideable per claim.</p>
        </fieldset>

        <fieldset class="form-block account-block-links">
          <legend>Links</legend>
          <p class="hint">Optional profile links. Label is required for non-social URLs.</p>
          <div class="account-links">
            <div id="links-list" class="account-links-list">${linkRowHtml(user.links?.length ? user.links : [{ label: "", url: "" }])}</div>
            <div class="account-links-foot">
              <button type="button" class="btn ghost" id="add-link-btn">Add link</button>
            </div>
          </div>
        </fieldset>

        <fieldset class="form-block account-funder-credit account-block-narrow">
          <legend>Funder appearance</legend>
          <p class="hint">How you show up on project funder lists after a donation is linked to your account. Amounts stay private unless you opt in.</p>
          ${creditPreferenceFieldsHtml({ idPrefix: "account-credit" })}
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Save profile</button>
        </div>
        <p class="form-msg" id="account-msg" hidden></p>
      </form>

      ${identityPanelHtml(user)}
      ${linkedOrgsPanelHtml(user)}

      <div class="account-danger">
        <button type="button" class="btn-text-danger" id="delete-account-btn">Delete account</button>
        <p class="form-msg" id="delete-account-msg" hidden></p>
      </div>
      </div>

      <div class="account-pane" data-pane="watching" ${tab === "watching" ? "" : "hidden"}>
        ${
          watchRows.length === 0
            ? `<div class="empty-state"><div class="empty-state-inner">
                <p class="empty-state-title">No watched projects</p>
                <p class="empty-state-body">Open a project and tap Watch to follow funding.</p>
                <a class="btn" href="${href("/")}">Browse projects</a>
              </div></div>`
            : `<ul class="work-list">${watchRows
                .map(({ w, p, bal }) => {
                  const title = p?.title || w.proposal_id;
                  const href = proposalHref(w.proposal_path, p?.id || w.proposal_id);
                  const open =
                    p &&
                    isOpenToClaim(
                      { ...p, balance_sats: bal },
                      CLAIM_FLOOR_SATS,
                    );
                  return `<li>
                    <a href="${href}">${escapeHtml(title)}</a>
                    <span class="pill">${open ? "Open to claim" : formatSats(bal ?? 0)}</span>
                  </li>`;
                })
                .join("")}</ul>`
        }
      </div>

      <div class="account-pane" data-pane="claims" ${tab === "claims" ? "" : "hidden"}>
        ${claimsPaneHtml(pendingClaims, ledger)}
      </div>

      <div class="account-pane" data-pane="proposals" ${tab === "proposals" ? "" : "hidden"}>
        ${
          myProposals.length === 0
            ? `<div class="empty-state"><div class="empty-state-inner">
                <p class="empty-state-title">No proposals yet</p>
                <p class="empty-state-body">Describe the work and open a proposal.</p>
                <a class="btn" href="${href("/propose")}">Start a project</a>
              </div></div>`
            : `<ul class="work-list">${myProposals
                .map(
                  (p) => `<li>
                    <a href="${proposalHref(p.path, p.id)}">${escapeHtml(p.title)}</a>
                    <span class="pill">${escapeHtml(String(p.status))}</span>
                  </li>`,
                )
                .join("")}</ul>`
        }
      </div>

      <div class="account-pane" data-pane="notifications" ${tab === "notifications" ? "" : "hidden"}>
        <div class="notify-toolbar">
          <p class="notify-toolbar-lede">Lifecycle updates for projects you watch.</p>
          <button type="button" class="btn ghost" id="notifications-read-btn" ${notifications.some((n) => !n.read_at) ? "" : "disabled"}>Mark all read</button>
        </div>
        ${
          notifications.length === 0
            ? `<div class="empty-state"><div class="empty-state-inner">
                <p class="empty-state-title">No notifications</p>
                <p class="empty-state-body">Watch a project to get funding and claim updates here.</p>
              </div></div>`
            : `<ul class="work-list notify-list">${notifications
                .map((notification) => {
                  const label = notificationLabel(notification.type);
                  const when = formatNotifyWhen(notification.created_at);
                  return `<li class="notify-row ${notification.read_at ? "is-read" : "is-new"}">
                    <a class="notify-main" href="${proposalHref(notification.proposal_path, notification.proposal_id)}">
                      <span class="notify-title">${escapeHtml(label)}</span>
                      <span class="notify-id mono">${escapeHtml(notification.proposal_id)}</span>
                    </a>
                    <span class="notify-meta">
                      ${notification.read_at ? "" : `<span class="notify-new">New</span>`}
                      <time class="muted" datetime="${escapeHtml(notification.created_at)}">${escapeHtml(when)}</time>
                    </span>
                  </li>`;
                })
                .join("")}</ul>`
        }
      </div>
    </section>
  `);

  app.querySelectorAll<HTMLButtonElement>(".account-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn.dataset.tab || "profile") as AccountTab;
      // Watching/proposals need the catalog — reload once if we skipped it.
      if (
        (name === "watching" || name === "proposals") &&
        !needsCatalog &&
        allProps.length === 0
      ) {
        void renderAccount(ctx, name);
        return;
      }
      // Notifications list is fetched only for that tab.
      if (name === "notifications" && !needsNotifications) {
        void renderAccount(ctx, name);
        return;
      }
      app.querySelectorAll(".account-tab").forEach((t) => {
        t.classList.toggle("active", t === btn);
      });
      app.querySelectorAll<HTMLElement>(".account-pane").forEach((pane) => {
        pane.hidden = pane.dataset.pane !== name;
      });
      history.replaceState(
        null,
        "",
        name === "profile" ? href("/account") : href("/account", `?tab=${name}`),
      );
    });
  });

  const form = document.getElementById("account-form") as HTMLFormElement | null;
  const msg = document.getElementById("account-msg");
  const linksList = document.getElementById("links-list");
  const orgMsg = document.getElementById("org-link-msg");

  const orgLinkParam = new URLSearchParams(location.search).get("org_link");
  if (orgMsg && orgLinkParam) {
    orgMsg.hidden = false;
    if (orgLinkParam === "ok") {
      orgMsg.className = "form-msg success";
      orgMsg.textContent = "GitHub orgs updated from your admin memberships.";
    } else if (orgLinkParam === "github_required") {
      orgMsg.className = "form-msg error";
      orgMsg.textContent = "Sign in with GitHub before linking orgs.";
    }
  }

  document
    .getElementById("link-github-orgs-btn")
    ?.addEventListener("click", async () => {
      const btn = document.getElementById(
        "link-github-orgs-btn",
      ) as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      try {
        const url = await startGithubOrgLink("/account");
        window.location.href = url;
      } catch (e) {
        if (orgMsg) {
          orgMsg.hidden = false;
          orgMsg.className = "form-msg error";
          orgMsg.textContent = (e as Error).message;
        }
        if (btn) btn.disabled = false;
      }
    });

  app.querySelectorAll<HTMLButtonElement>("[data-unlink-org]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const login = btn.dataset.unlinkOrg;
      if (!login) return;
      btn.disabled = true;
      try {
        const next = await unlinkGithubOrg(login);
        ctx.user = next;
        if (orgMsg) {
          orgMsg.hidden = false;
          orgMsg.className = "form-msg success";
          orgMsg.textContent = `Unlinked @${login}.`;
        }
        void renderAccount(ctx, "profile");
      } catch (e) {
        if (orgMsg) {
          orgMsg.hidden = false;
          orgMsg.className = "form-msg error";
          orgMsg.textContent = (e as Error).message;
        }
        btn.disabled = false;
      }
    });
  });

  bindCreditPreferenceGates(app, "account-credit");
  applyCreditPreferencesToFields(app, creditPrefs, "account-credit");
  const skillsTags = bindTagInput(app, "skills-tags", {
    vocabulary: SUGGESTED_SKILLS_TAGS,
  });

  linksList?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const btn = t?.closest?.(".remove-link");
    if (!btn || !linksList.contains(btn)) return;
    e.preventDefault();
    btn.closest(".link-row")?.remove();
  });

  document.getElementById("add-link-btn")?.addEventListener("click", () => {
    if (!linksList) return;
    const rows = linksList.querySelectorAll(".link-row");
    if (rows.length >= 8) {
      if (msg) {
        msg.hidden = false;
        msg.className = "form-msg error";
        msg.textContent = "At most 8 profile links.";
      }
      return;
    }
    linksList.insertAdjacentHTML(
      "beforeend",
      `<div class="link-row" data-index="${rows.length}">
        <input type="text" class="link-label" placeholder="Label" maxlength="40" aria-label="Link label" />
        <input type="text" class="link-url mono" inputmode="url" placeholder="https://…" maxlength="300" aria-label="Link URL" />
        <button type="button" class="editor-remove remove-link">Remove</button>
      </div>`,
    );
  });

  document.getElementById("claim-username-btn")?.addEventListener("click", async () => {
    if (!msg) return;
    const input = document.getElementById("username-input") as HTMLInputElement;
    msg.hidden = false;
    msg.className = "form-msg";
    msg.textContent = "Claiming username…";
    try {
      await claimUsername(input.value.trim());
      msg.textContent = "Username claimed.";
      msg.className = "form-msg success";
      ctx.rerender();
    } catch (e) {
      msg.textContent = (e as Error).message;
      msg.className = "form-msg error";
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!msg || !linksList) return;
    msg.hidden = false;
    msg.textContent = "Saving…";
    msg.className = "form-msg";
    try {
      const links: ProfileLink[] = [];
      linksList.querySelectorAll(".link-row").forEach((row) => {
        const label = (row.querySelector(".link-label") as HTMLInputElement).value.trim();
        const url = (row.querySelector(".link-url") as HTMLInputElement).value.trim();
        // Empty URL = discard the row (same as Remove). Label-only drafts are not saved.
        if (!url) return;
        if (!url.startsWith("https://")) {
          throw new Error("Link URLs must start with https://");
        }
        if (!label && !isKnownSocialUrl(url)) {
          throw new Error("Add a custom label, or use a supported social profile URL.");
        }
        links.push({ label, url });
      });
      const bio = (document.getElementById("bio-input") as HTMLTextAreaElement).value;
      const payout_address = (
        document.getElementById("payout-input") as HTMLInputElement
      ).value.trim();
      const skills_tags = skillsTags?.getTags() || [];
      const credit = readCreditPreferences(app, "account-credit");
      const funder_credit = {
        public_credit: credit.public_credit,
        show_amount: credit.show_amount,
      };
      const saved = await updateProfile({
        bio,
        links,
        payout_address,
        skills_tags,
        funder_credit,
      });
      saveStoredCreditPreferences(credit);
      syncStoredCreditPreferencesFromProfile(saved.funder_credit || funder_credit);
      msg.textContent = "Profile saved.";
      msg.className = "form-msg success";
      ctx.rerender();
    } catch (err) {
      msg.textContent = (err as Error).message;
      msg.className = "form-msg error";
    }
  });

  document.getElementById("delete-account-btn")?.addEventListener("click", async () => {
    const deleteMsg = document.getElementById("delete-account-msg");
    const confirmed = window.confirm(
      "Delete your Plebly account? This removes your profile, watch list, and saved settings. This cannot be undone.",
    );
    if (!confirmed) return;
    if (deleteMsg) {
      deleteMsg.hidden = false;
      deleteMsg.textContent = "Deleting account…";
      deleteMsg.className = "form-msg";
    }
    try {
      await deleteAccount();
      navigate("/", { replace: true });
      ctx.rerender();
    } catch (err) {
      if (deleteMsg) {
        deleteMsg.textContent = (err as Error).message;
        deleteMsg.className = "form-msg error";
      }
    }
  });

  document.getElementById("notifications-read-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById(
      "notifications-read-btn",
    ) as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      const remaining = await markNotificationsRead();
      ctx.setUnreadNotifications?.(remaining);
      updateNavUnreadBadge(remaining);
      ctx.rerender();
    } catch (err) {
      if (btn) btn.disabled = false;
      window.alert((err as Error).message);
    }
  });
}

function formatNotifyWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const delta = Date.now() - t;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(t).toLocaleDateString();
}

export async function renderPublicProfile(
  ctx: ShellContext,
  username: string,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = ctx.shell(`
    <section class="wrap detail"><p class="loading">Loading profile…</p></section>
  `);

  const profile = await fetchPublicProfile(username);
  if (!profile) {
    applySeo({
      title: "Profile not found",
      description: "This Plebly profile could not be found.",
      path: `/u/${encodeURIComponent(username)}`,
      noindex: true,
    });
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Profile not found</h1>
        <p>No profile for <span class="mono">${escapeHtml(username)}</span>.</p>
      </section>
    `);
    return;
  }

  applySeo(
    seoForRoute(
      { name: "profile", username: profile.username || username },
      {
        title: `@${profile.username || username}`,
        description: profile.bio?.trim().slice(0, 160) || undefined,
      },
    ),
  );

  const all = await listAllPublicProposals();
  const work = proposalsForProfile(all, profile);

  const linksHtml = profileLinksListHtml(profile);

  const workHtml =
    work.length === 0
      ? `<div class="empty-state"><div class="empty-state-inner">
          <p class="empty-state-title">No public proposals</p>
          <p class="empty-state-body">Proposals linked to this profile will show here.</p>
        </div></div>`
      : `<ul class="work-list">${work
          .map(
            (p) =>
              `<li><a href="${proposalHref(p.path, p.id)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
          )
          .join("")}</ul>`;

  const s = profile.claim_summary;
  const claimStatsHtml = s
    ? `<div class="claim-summary">
        <span class="pill">Claims done ${s.completed}</span>
        <span class="pill">Active ${s.active}</span>
        <span class="pill">Expired ${s.expired}</span>
        <span class="pill">Abandoned ${s.abandoned}</span>
        <span class="pill">Rejected ${s.rejected}</span>
      </div>`
    : "";
  const fundedCount = profile.funded_completed_count ?? 0;
  const streak = profile.funder_streak ?? 0;
  const impactHtml = `<div class="funder-impact">
      <p class="funder-impact-primary">Funded <span class="mono">${fundedCount}</span> completed ${fundedCount === 1 ? "bounty" : "bounties"}${
        streak > 0
          ? ` <span class="funder-streak" title="Completion streak">⚡ ${streak}</span>`
          : ""
      }</p>
      ${
        typeof profile.funded_sats_total === "number" &&
        profile.funded_sats_total > 0
          ? `<p class="funder-impact-sats muted">${escapeHtml(formatSats(profile.funded_sats_total))} credited (when shown)</p>`
          : ""
      }
    </div>`;
  const suspendHtml = profile.claim_suspended
    ? `<p class="error">Claiming suspended${
        profile.claim_suspend_reason
          ? `: ${escapeHtml(profile.claim_suspend_reason)}`
          : ""
      }${
        profile.claim_suspend_until
          ? ` until ${escapeHtml(new Date(profile.claim_suspend_until).toLocaleDateString())}`
          : ""
      }.</p>`
    : "";
  const muteHtml = profile.discussion_muted
    ? `<p class="error">Discussion muted${
        profile.discussion_mute_reason
          ? `: ${escapeHtml(profile.discussion_mute_reason)}`
          : ""
      }${
        profile.discussion_muted_until
          ? ` until ${escapeHtml(new Date(profile.discussion_muted_until).toLocaleDateString())}`
          : ""
      }.</p>`
    : "";

  app.innerHTML = ctx.shell(`
    <section class="wrap detail profile-page">
      <div class="profile-header">
        ${profile.avatar_url ? `<img class="avatar" src="${escapeHtml(profile.avatar_url)}" alt="" width="64" height="64" />` : ""}
        <div>
          <h1>${escapeHtml(profile.username || username)}</h1>
          ${
            profile.reviewer_active
              ? `<p class="reviewer-badge"><span class="pill status-good">Active reviewer</span> <span class="muted">${escapeHtml(profile.reviewer_kind || "earned")} · <a href="${href("/reviewers")}">roster</a></span></p>`
              : ""
          }
        </div>
      </div>
      ${suspendHtml}
      ${muteHtml}
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${linksHtml}
      ${impactHtml}
      ${claimStatsHtml ? `<h2 class="section-title">Claim record</h2>${claimStatsHtml}` : ""}
      <h2 class="section-title">Proposals</h2>
      ${workHtml}
    </section>
  `);
}
