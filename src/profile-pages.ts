import {
  authFetch,
  claimUsername,
  confirmGithubOrgs,
  deleteAccount,
  fetchPendingGithubOrgs,
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
import {
  fetchMyClaims,
  fetchWatches,
  isOpenToClaim,
  removeWatch,
  type ClaimLedgerView,
} from "./builder";
import { BITCOIN_NETWORK, CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import {
  applyCreditPreferencesToFields,
  bindCreditPreferenceGates,
  creditPreferenceFieldsHtml,
  loadStoredCreditPreferences,
  readCreditPreferences,
  saveStoredCreditPreferences,
  syncStoredCreditPreferencesFromProfile,
} from "./funder-credit";
import { orgAttestationTitle, orgLoginLabel } from "./github-orgs-client";
import {
  listAllPublicProposals,
  listListedProposals,
  proposalsForProfile,
} from "./github";
import { nostrAccountLink, socialAccountLink } from "./icons";
import { addressBalanceSats } from "./mempool";
import {
  notificationTargetHref,
  notificationTypeLabel,
} from "./notify-labels";
import { hydrateAvatarSlots, orgAvatarSlotHtml } from "./profile-avatars";
import { fetchReviewerMe } from "./reviewers";
import {
  applySeo,
  href,
  navigate,
  orgHref,
  proposalHref,
  seoForRoute,
} from "./router";
import {
  MAX_SKILLS_TAGS,
  SKILLS_PRESET_TAGS,
  SUGGESTED_SKILLS_TAGS,
} from "./skills-tags";
import { isKnownSocialUrl, profileLinksListHtml } from "./social-links";
import { bindTagInput, tagInputHtml } from "./tag-input";
import type { ProfileLink, Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";
import { bindWebPushPanel, webPushPanelHtml } from "./web-push";

const MEMPOOL_WEB =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet"
    : "https://mempool.space";

function txExplorerLink(txid: string, label?: string): string {
  const short = `${txid.slice(0, 12)}…`;
  return `<a class="mono" href="${escapeHtml(`${MEMPOOL_WEB}/tx/${encodeURIComponent(txid)}`)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label || short)}</a>`;
}

export type ShellContext = {
  user: AuthUser | null;
  routeName: string;
  shell: (inner: string) => string;
  rerender: () => void;
  /** Keep the top-nav unread badge in sync after mark-read actions. */
  setUnreadNotifications?: (count: number) => void;
};

type AccountTab =
  | "profile"
  | "watching"
  | "claims"
  | "funds"
  | "proposals"
  | "notifications";

function notificationLabel(
  type: string,
  payload?: { needs_address?: boolean; needs_refund_address?: boolean },
): string {
  return notificationTypeLabel(type, payload);
}

function fundsPaneHtml(): string {
  return `<div class="account-funds">
    <section>
      <h2 class="proposal-block-title">Claim bonds</h2>
      <p class="muted">Refundable bonds are batched by keyholders (Sparrow). Set an on-chain address or Lightning Address while status is refundable.</p>
      <div id="funds-bonds"><p class="muted">Loading…</p></div>
    </section>
    <section>
      <h2 class="proposal-block-title">Contribution refunds</h2>
      <p class="muted">When a project is refunding, register an address on the proposal page. Paid refunds show a txid here.</p>
      <div id="funds-refunds"><p class="muted">Loading…</p></div>
    </section>
    <p class="builder-msg" id="funds-msg" hidden></p>
  </div>`;
}

function keyholderKeysCardHtml(kh: {
  status: string;
  fingerprint?: string | null;
  xpub?: string | null;
} | null): string {
  if (!kh) return "";
  if (
    kh.status !== "invited" &&
    kh.status !== "pending_attest" &&
    kh.status !== "active"
  ) {
    return "";
  }
  const fp = kh.fingerprint
    ? `<p class="mono">${escapeHtml(kh.fingerprint)}</p>`
    : `<p class="muted">Fingerprint not submitted yet.</p>`;
  const xpub = kh.xpub
    ? `<p class="mono muted" style="word-break:break-all">${escapeHtml(kh.xpub.slice(0, 28))}…</p>`
    : "";
  const wait =
    kh.status === "pending_attest"
      ? `<p class="muted">Waiting for two active keyholders to co-attest.</p>`
      : kh.status === "invited"
        ? `<p class="muted">Submit fingerprint + xpub in the console.</p>`
        : "";
  return `<div class="form-panel" id="account-keyholder-card">
    <h2 class="proposal-block-title">Keyholder keys</h2>
    <p><span class="pill">${escapeHtml(kh.status)}</span></p>
    ${fp}${xpub}${wait}
    <p><a class="btn ghost" href="${href("/keyholders")}">Open keyholders console</a></p>
  </div>`;
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
      <p class="empty-state-body">When escrow hits the claim floor, apply with a bond from the project page.</p>
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

const ORG_ATTESTATION_MS = 90 * 86_400_000;

/** Profile fieldset: sign-in identities + GitHub org linking (apply-as-org). */
async function fetchGithubOrgAccessUrl(): Promise<string | null> {
  if (!WORKERS_API) return null;
  try {
    const res = await fetch(
      `${WORKERS_API.replace(/\/$/, "")}/auth/github/public`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { org_access_url?: string };
    return data.org_access_url?.trim() || null;
  } catch {
    return null;
  }
}

export function connectedAccountsHtml(user: AuthUser): string {
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
  const identities = links.length
    ? `<div class="account-connected-identities social-row">${links.join("")}</div>`
    : `<p class="hint">No linked login providers on this session.</p>`;

  const githubSession = user.id.startsWith("github:") && Boolean(user.github);
  const orgs = user.github_orgs || [];
  const now = Date.now();
  const rows = orgs
    .map((o) => {
      const login = orgLoginLabel(o.login);
      const title = orgAttestationTitle(o);
      const at = Date.parse(o.verified_at);
      const fresh = Number.isFinite(at) && now - at <= ORG_ATTESTATION_MS;
      const when = Number.isFinite(at)
        ? new Date(at).toISOString().slice(0, 10)
        : "?";
      const avatar = o.avatar_url
        ? `<img class="avatar account-org-card-avatar" src="${escapeHtml(o.avatar_url)}" alt="" width="36" height="36" loading="lazy" />`
        : `<span class="user-avatar-slot org-avatar-slot" data-avatar-org="${escapeHtml(login)}" hidden></span>`;
      return `<li class="account-org-card">
        <a class="account-org-card-link" href="${orgHref(login)}">
          ${avatar}
          <span class="account-org-card-title">${escapeHtml(title)}</span>
        </a>
        <p class="account-org-card-meta muted">${fresh ? `Admin · verified ${when}` : "Stale — refresh"}</p>
        <button type="button" class="btn ghost btn-compact account-org-unlink" data-unlink-org="${escapeHtml(login)}">Unlink</button>
      </li>`;
    })
    .join("");

  const orgCount = orgs.length;
  const orgHeading =
    orgCount > 0 ? `Organizations · ${orgCount} linked` : "Organizations";

  let orgBlock: string;
  if (!githubSession) {
    orgBlock = `<div class="account-orgs" id="account-orgs">
      <h2 class="section-title account-orgs-heading">${orgHeading}</h2>
      <p class="hint">Sign in with GitHub to view and link organizations you own. Then you can apply for claims or propose projects as that org.</p>
    </div>`;
  } else if (rows) {
    orgBlock = `<div class="account-orgs" id="account-orgs">
      <h2 class="section-title account-orgs-heading">${orgHeading}</h2>
      <p class="hint">Orgs you own on GitHub. Use them to apply or propose as that organization.</p>
      <ul class="account-org-grid" aria-label="Linked GitHub organizations">${rows}</ul>
      <div class="account-org-actions">
        <a class="btn btn-compact" id="add-org-grant-link" href="#" rel="noreferrer noopener">Add organization</a>
        <button type="button" class="btn ghost btn-compact" id="sync-github-orgs-btn">Sync from GitHub</button>
      </div>
      <div id="org-pick-panel" class="account-org-pick" hidden></div>
      <p class="hint" id="org-access-hint">Add organization opens GitHub so you can grant this app access to another org you own. Then Sync from GitHub to link it here.</p>
      <p class="form-msg" id="org-link-msg" hidden></p>
    </div>`;
  } else {
    orgBlock = `<div class="account-orgs" id="account-orgs">
      <h2 class="section-title account-orgs-heading">${orgHeading}</h2>
      <p class="hint">No organizations linked yet. Link orgs you <strong>own</strong> to apply or propose as that organization.</p>
      <div class="account-org-actions">
        <button type="button" class="btn btn-compact" id="link-github-orgs-btn">Add organization</button>
      </div>
      <p class="hint" id="org-access-hint">Enable each org under Organization access for this app, then add it here.</p>
      <div id="org-pick-panel" class="account-org-pick" hidden></div>
      <p class="form-msg" id="org-link-msg" hidden></p>
    </div>`;
  }

  return `<fieldset class="form-block account-block-connected">
    <legend>Connected accounts</legend>
    ${identities}
    ${orgBlock}
  </fieldset>`;
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
        <p class="lede">Sign in to watch projects, apply for funded work, and manage your profile.</p>
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
  const [watches, myClaims, allProps, reviewerMe, notifications, keyholderMe] =
    await Promise.all([
      fetchWatches().catch(() => []),
      fetchMyClaims().catch(() => ({ pending: [], ledger: null })),
      needsCatalog
        ? listListedProposals().catch(() => [] as Proposal[])
        : Promise.resolve([] as Proposal[]),
      fetchReviewerMe().catch(() => null),
      needsNotifications
        ? fetchNotifications().catch(() => [] as ProposalNotification[])
        : Promise.resolve([] as ProposalNotification[]),
      WORKERS_API
        ? authFetch(`${WORKERS_API.replace(/\/$/, "")}/keyholders/me`)
            .then(async (r) =>
              r.ok
                ? ((await r.json()) as {
                    keyholder: {
                      status: string;
                      fingerprint?: string | null;
                      xpub?: string | null;
                    } | null;
                  })
                : { keyholder: null },
            )
            .catch(() => ({ keyholder: null }))
        : Promise.resolve({ keyholder: null }),
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
        <button type="button" class="account-tab ${tab === "funds" ? "active" : ""}" data-tab="funds">Funds</button>
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
      ${keyholderKeysCardHtml(keyholderMe.keyholder)}
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
          <legend>Payout destination</legend>
          <input id="payout-input" class="mono" type="text" value="${escapeHtml(user.payout_address || "")}" placeholder="bc1… / tb1… or you@host" maxlength="120" />
          <p class="hint">Default for bond refunds and claim escrow payouts — on-chain bech32 or Lightning Address.</p>
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

        ${connectedAccountsHtml(user)}

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
            : `<ul class="work-list" id="watching-list">${watchRows
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
                    <span class="pill">${open ? "Open to apply" : formatSats(bal ?? 0)}</span>
                    <button type="button" class="btn ghost btn-compact work-list-action" data-unwatch="${escapeHtml(w.proposal_path)}">Unwatch</button>
                  </li>`;
                })
                .join("")}</ul>`
        }
      </div>

      <div class="account-pane" data-pane="claims" ${tab === "claims" ? "" : "hidden"}>
        ${claimsPaneHtml(pendingClaims, ledger)}
      </div>

      <div class="account-pane" data-pane="funds" ${tab === "funds" ? "" : "hidden"}>
        ${fundsPaneHtml()}
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
        ${webPushPanelHtml()}
        ${
          notifications.length === 0
            ? `<div class="empty-state"><div class="empty-state-inner">
                <p class="empty-state-title">No notifications</p>
                <p class="empty-state-body">Watch a project to get funding and claim updates here.</p>
              </div></div>`
            : `<ul class="work-list notify-list">${notifications
                .map((notification) => {
                  const label = notificationLabel(
                    notification.type,
                    notification.payload,
                  );
                  const when = formatNotifyWhen(notification.created_at);
                  return `<li class="notify-row ${notification.read_at ? "is-read" : "is-new"}">
                    <a class="notify-main" href="${notificationTargetHref(notification)}">
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

  const watchingPane = app.querySelector<HTMLElement>('[data-pane="watching"]');
  watchingPane
    ?.querySelectorAll<HTMLButtonElement>("[data-unwatch]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.dataset.unwatch;
        if (!path) return;
        btn.disabled = true;
        try {
          await removeWatch(path);
          const row = btn.closest("li");
          row?.remove();
          const list = watchingPane.querySelector("#watching-list");
          if (list && list.children.length === 0) {
            watchingPane.innerHTML = `<div class="empty-state"><div class="empty-state-inner">
                <p class="empty-state-title">No watched projects</p>
                <p class="empty-state-body">Open a project and tap Watch to follow funding.</p>
                <a class="btn" href="${href("/")}">Browse projects</a>
              </div></div>`;
          }
        } catch (e) {
          btn.disabled = false;
          window.alert((e as Error).message || "Could not unwatch.");
        }
      });
    });

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
      if (name === "funds") void loadFundsPane();
    });
  });

  const loadFundsPane = async () => {
    if (!WORKERS_API) return;
    const api = WORKERS_API.replace(/\/$/, "");
    const bondsEl = app.querySelector("#funds-bonds");
    const refundsEl = app.querySelector("#funds-refunds");
    const msgEl = app.querySelector<HTMLElement>("#funds-msg");
    const [bondsRes, refundsRes] = await Promise.all([
      authFetch(`${api}/claims/bonds/mine`),
      authFetch(`${api}/refunds/mine`),
    ]);
    if (bondsEl) {
      if (!bondsRes.ok) {
        bondsEl.innerHTML = `<p class="muted">Could not load bonds.</p>`;
      } else {
        const data = (await bondsRes.json()) as {
          bonds: {
            proposal_id: string;
            status: string;
            amount_sats: number;
            txid: string;
            refund_address?: string;
            refund_txid?: string;
            address_frozen?: boolean;
            needs_refund_address?: boolean;
            claimer_login?: string;
            claimer_type?: string;
          }[];
        };
        bondsEl.innerHTML = data.bonds.length
          ? `<ul class="work-list">${data.bonds
              .map(
                (b) => `<li class="work-row">
                <div>
                  <a href="${href(`/p/${encodeURIComponent(b.proposal_id)}`)}">${escapeHtml(b.proposal_id)}</a>
                  ${
                    b.claimer_type === "org" && b.claimer_login
                      ? `<span class="pill">@${escapeHtml(b.claimer_login)}</span>`
                      : ""
                  }
                  <span class="pill">${escapeHtml(b.status)}</span>
                  ${
                    b.needs_refund_address
                      ? `<span class="pill">needs address</span>`
                      : ""
                  }
                  <span class="muted">${formatSats(b.amount_sats)}</span>
                  <p class="muted">Bond ${txExplorerLink(b.txid)}</p>
                  ${
                    b.status === "forfeited" || b.status === "locked"
                      ? `<p class="muted">${
                          b.status === "forfeited"
                            ? "Forfeited (expired, abandoned, or final reject) — not refundable."
                            : "Locked while the claim is active or in rebuttal."
                        }</p>`
                      : ""
                  }
                  ${
                    b.status === "refundable"
                      ? `<label class="sr-only" for="bond-addr-${escapeHtml(b.proposal_id)}">Refund address</label>
                         <input id="bond-addr-${escapeHtml(b.proposal_id)}" class="donate-amount mono" ${
                           b.address_frozen ? "disabled" : ""
                         } value="${escapeHtml(b.refund_address || "")}" placeholder="bc1… / tb1… or you@host" />
                         ${
                           b.address_frozen
                             ? `<p class="muted">Destination frozen for keyholder batch.</p>`
                             : `<button type="button" class="btn ghost" data-bond-addr="${escapeHtml(b.proposal_id)}">${
                                 b.needs_refund_address
                                   ? "Set refund destination"
                                   : "Save destination"
                               }</button>`
                         }`
                      : ""
                  }
                  ${
                    b.refund_txid
                      ? `<p class="muted">Refunded ${txExplorerLink(b.refund_txid)}</p>`
                      : ""
                  }
                </div>
              </li>`,
              )
              .join("")}</ul>`
          : `<div class="empty-state"><div class="empty-state-inner">
              <p class="empty-state-title">No bond refunds yet</p>
              <p class="empty-state-body">When you withdraw an application or finish a claim, refundable bonds show up here so you can set a refund address.</p>
            </div></div>`;
        bondsEl.querySelectorAll<HTMLButtonElement>("[data-bond-addr]").forEach(
          (btn) => {
            btn.addEventListener("click", async () => {
              const id = btn.dataset.bondAddr || "";
              const input = app.querySelector<HTMLInputElement>(
                `#bond-addr-${CSS.escape(id)}`,
              );
              const res = await authFetch(
                `${api}/claims/bonds/${encodeURIComponent(id)}/refund-address`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    refund_address: input?.value.trim() || "",
                  }),
                },
              );
              const body = (await res.json().catch(() => ({}))) as {
                error?: string;
                package_error?: boolean;
                note?: string;
              };
              if (msgEl) {
                msgEl.hidden = false;
                msgEl.textContent =
                  res.ok || body.package_error
                    ? body.package_error
                      ? body.note ||
                        "Address saved, but the keyholder package failed — try again."
                      : "Refund address saved."
                    : body.error || "Could not save.";
              }
              if (res.ok || body.package_error) void loadFundsPane();
            });
          },
        );
      }
    }
    if (refundsEl) {
      if (!refundsRes.ok) {
        refundsEl.innerHTML = `<p class="muted">Could not load contribution refunds.</p>`;
      } else {
        const data = (await refundsRes.json()) as {
          refunds: {
            proposal_id: string;
            amount_sats: number;
            status: string;
            rail?: string;
            swap_id?: string;
            txid?: string;
            vout?: number;
            refund_address?: string;
            refund_txid?: string;
            needs_address?: boolean;
            non_refundable_dust?: boolean;
          }[];
        };
        refundsEl.innerHTML = data.refunds.length
          ? `<ul class="work-list">${data.refunds
              .map(
                (r) => `<li class="work-row">
                <a href="${href(`/p/${encodeURIComponent(r.proposal_id)}`)}">${escapeHtml(r.proposal_id)}</a>
                <span class="pill">${escapeHtml(r.status)}</span>
                ${r.rail ? `<span class="pill">${escapeHtml(r.rail)}</span>` : ""}
                <span class="muted">${formatSats(r.amount_sats)}</span>
                ${
                  r.swap_id
                    ? `<p class="mono muted">swap ${escapeHtml(r.swap_id)}</p>`
                    : r.txid != null
                      ? `<p class="mono muted">${escapeHtml(r.txid.slice(0, 12))}…:${r.vout ?? 0}</p>`
                      : ""
                }
                ${
                  r.refund_txid
                    ? `<p class="muted">Paid ${txExplorerLink(r.refund_txid)}</p>`
                    : r.non_refundable_dust
                      ? `<p class="muted">Below dust — not packaged for refund.</p>`
                      : r.refund_address
                        ? `<p class="mono muted">${escapeHtml(r.refund_address)}</p>`
                        : `<p class="muted">Needs address — register on the proposal when status is refunding${
                            r.rail === "lightning" ? " (use your swap id)" : ""
                          }.</p>`
                }
              </li>`,
              )
              .join("")}</ul>`
          : `<div class="empty-state"><div class="empty-state-inner">
              <p class="empty-state-title">No contribution refunds</p>
              <p class="empty-state-body">If a project enters refunding, register your address on the proposal page (on-chain outpoint or Lightning swap id). Paid refunds appear here with a txid.</p>
            </div></div>`;
      }
    }
  };

  if (tab === "funds") void loadFundsPane();

  const form = document.getElementById("account-form") as HTMLFormElement | null;
  const msg = document.getElementById("account-msg");
  const linksList = document.getElementById("links-list");
  const orgMsg = document.getElementById("org-link-msg");

  const orgParams = new URLSearchParams(location.search);
  const orgLinkParam = orgParams.get("org_link");
  const orgPickPanel = document.getElementById("org-pick-panel");

  const linkedOrgSet = new Set(
    (ctx.user.github_orgs || []).map((o) => o.login.toLowerCase()),
  );

  const showOrgPick = async () => {
    if (!orgPickPanel || !orgMsg) return;
    const pending = await fetchPendingGithubOrgs();
    if (!pending.length) {
      orgMsg.hidden = false;
      orgMsg.className = "form-msg error";
      orgMsg.textContent =
        "Org discovery expired or empty — grant org access on GitHub, then try Add organization again.";
      return;
    }
    const fresh = pending.filter(
      (o) => !linkedOrgSet.has(o.login.toLowerCase()),
    );
    if (!fresh.length) {
      orgMsg.hidden = false;
      orgMsg.className = "form-msg";
      orgMsg.textContent =
        "GitHub only returned orgs you already linked. Grant this app access for another org you own, then try Add organization again.";
      return;
    }
    orgPickPanel.hidden = false;
    orgPickPanel.innerHTML = `
      <h2 class="section-title account-orgs-heading">Choose organizations to link</h2>
      <p class="hint">Select orgs you own that are not linked yet. Already-linked orgs stay as they are.</p>
      <ul class="account-org-pick-list">
        ${pending
          .map((o) => {
            const login = orgLoginLabel(o.login);
            const already = linkedOrgSet.has(login.toLowerCase());
            const avatar = o.avatar_url
              ? `<img class="avatar account-org-card-avatar" src="${escapeHtml(o.avatar_url)}" alt="" width="36" height="36" loading="lazy" />`
              : `<span class="user-avatar-slot org-avatar-slot" data-avatar-org="${escapeHtml(login)}" hidden></span>`;
            return `<li>
              <label class="account-org-pick-row${already ? " is-linked" : ""}">
                <input type="checkbox" name="org-pick" value="${escapeHtml(login)}" ${
                  already ? "disabled" : "checked"
                } />
                ${avatar}
                <span class="account-org-pick-label">${escapeHtml(login)}${already ? ` <span class="muted">(already linked)</span>` : ""}</span>
              </label>
            </li>`;
          })
          .join("")}
      </ul>
      <div class="account-org-pick-actions">
        <button type="button" class="btn btn-compact" id="org-pick-confirm">Link selected</button>
        <button type="button" class="btn ghost btn-compact" id="org-pick-cancel">Cancel</button>
      </div>`;
    document.getElementById("org-pick-cancel")?.addEventListener("click", () => {
      orgPickPanel.hidden = true;
      orgPickPanel.innerHTML = "";
    });
    document
      .getElementById("org-pick-confirm")
      ?.addEventListener("click", async () => {
        const logins = [
          ...orgPickPanel.querySelectorAll<HTMLInputElement>(
            'input[name="org-pick"]:checked:not(:disabled)',
          ),
        ].map((el) => el.value);
        if (!logins.length) {
          orgMsg.hidden = false;
          orgMsg.className = "form-msg error";
          orgMsg.textContent = "Select at least one new organization.";
          return;
        }
        const btn = document.getElementById(
          "org-pick-confirm",
        ) as HTMLButtonElement | null;
        if (btn) btn.disabled = true;
        try {
          const { user: next, linked } = await confirmGithubOrgs(logins);
          ctx.user = next;
          orgMsg.hidden = false;
          orgMsg.className = "form-msg success";
          orgMsg.textContent = linked.length
            ? `Linked ${linked.length} org${linked.length === 1 ? "" : "s"}: ${linked.map((l) => `@${l}`).join(", ")}.`
            : "No new organizations were linked.";
          void renderAccount(ctx, "profile");
        } catch (e) {
          orgMsg.hidden = false;
          orgMsg.className = "form-msg error";
          orgMsg.textContent = (e as Error).message;
          if (btn) btn.disabled = false;
        }
      });
  };

  if (orgMsg && orgLinkParam) {
    orgMsg.hidden = false;
    if (orgLinkParam === "ok") {
      const linked = (orgParams.get("linked_orgs") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      orgMsg.className = "form-msg success";
      orgMsg.textContent = linked.length
        ? `Linked ${linked.length} org${linked.length === 1 ? "" : "s"}: ${linked.map((l) => `@${l}`).join(", ")}.`
        : "No admin orgs returned from GitHub. Grant org access for this app, then refresh.";
    } else if (orgLinkParam === "already") {
      // Second+ org: OAuth only saw what was already linked — send them to GitHub
      // Organization access for this app (no useful in-app workflow beyond that).
      orgMsg.className = "form-msg";
      orgMsg.textContent = "Opening GitHub to grant this app access to another organization…";
      void fetchGithubOrgAccessUrl().then((url) => {
        if (url) {
          window.location.href = url;
          return;
        }
        orgMsg.className = "form-msg error";
        orgMsg.textContent =
          "Could not open GitHub org access. Use Add organization on this page.";
      });
    } else if (orgLinkParam === "pick") {
      orgMsg.className = "form-msg";
      orgMsg.textContent = "Select which organizations to link.";
      void showOrgPick();
    } else if (orgLinkParam === "empty") {
      orgMsg.className = "form-msg error";
      orgMsg.textContent =
        "GitHub returned no owner orgs. Grant organization access for this app, then try again.";
    } else if (orgLinkParam === "github_required") {
      orgMsg.className = "form-msg error";
      orgMsg.textContent = "Sign in with GitHub before linking orgs.";
    }
    const clean = new URL(location.href);
    clean.searchParams.delete("org_link");
    clean.searchParams.delete("linked_orgs");
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
  }

  const startOrgOauth = async (btn: HTMLButtonElement | null) => {
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
  };

  const grantLink = document.getElementById(
    "add-org-grant-link",
  ) as HTMLAnchorElement | null;
  if (grantLink && WORKERS_API) {
    void fetchGithubOrgAccessUrl().then((url) => {
      if (!url) return;
      grantLink.href = url;
      const hint = document.getElementById("org-access-hint");
      if (hint) {
        hint.innerHTML = `Add organization opens <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">GitHub organization access</a> for this app. Grant another org you own, then Sync from GitHub.`;
      }
    });
    grantLink.addEventListener("click", (e) => {
      if (grantLink.getAttribute("href") && grantLink.getAttribute("href") !== "#") {
        return;
      }
      e.preventDefault();
      void fetchGithubOrgAccessUrl().then((url) => {
        if (url) {
          grantLink.href = url;
          window.location.href = url;
          return;
        }
        if (orgMsg) {
          orgMsg.hidden = false;
          orgMsg.className = "form-msg error";
          orgMsg.textContent =
            "GitHub org-access URL unavailable — try Sync from GitHub.";
        }
      });
    });
  }

  const orgAccessHint = document.getElementById("org-access-hint");
  if (orgAccessHint && WORKERS_API && !grantLink) {
    void fetchGithubOrgAccessUrl().then((url) => {
      if (!url) return;
      orgAccessHint.innerHTML = `Missing an org? <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">Grant organization access</a> on GitHub for each org, then add it here.`;
    });
  }
  void hydrateAvatarSlots(app);

  document
    .getElementById("link-github-orgs-btn")
    ?.addEventListener("click", () => {
      void startOrgOauth(
        document.getElementById("link-github-orgs-btn") as HTMLButtonElement | null,
      );
    });

  document
    .getElementById("sync-github-orgs-btn")
    ?.addEventListener("click", () => {
      void startOrgOauth(
        document.getElementById(
          "sync-github-orgs-btn",
        ) as HTMLButtonElement | null,
      );
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
  void bindWebPushPanel(app);
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

function profilePublicOrgsHtml(
  orgs: { login: string; avatar_url: string; name: string | null }[],
): string {
  if (!orgs.length) return "";
  return `<h2 class="section-title">Organizations</h2>
      <ul class="org-member-grid profile-org-grid">${orgs
        .map((o) => {
          const login = o.login.replace(/^@/, "").trim();
          const label = o.name?.trim() || login;
          return `<li class="org-member-card">
            <a href="${orgHref(login)}" title="${escapeHtml(login)}">
              ${
                o.avatar_url
                  ? `<img class="avatar org-member-avatar" src="${escapeHtml(o.avatar_url)}" alt="" width="36" height="36" loading="lazy" />`
                  : orgAvatarSlotHtml(login)
              }
              <span>${escapeHtml(label)}</span>
            </a>
          </li>`;
        })
        .join("")}</ul>`;
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
  const orgsHtml = profilePublicOrgsHtml(profile.public_orgs || []);

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
      <header class="profile-hero profile-hero-user">
        ${
          profile.avatar_url
            ? `<div class="profile-hero-avatar">
                <img class="avatar profile-hero-avatar-img" src="${escapeHtml(profile.avatar_url)}" alt="" width="64" height="64" loading="lazy" />
              </div>`
            : ""
        }
        <div class="profile-hero-content">
          <div class="profile-hero-head">
            <h1>${escapeHtml(profile.username || username)}</h1>
          </div>
          ${
            profile.reviewer_active
              ? `<div class="profile-hero-details">
                  <p class="reviewer-badge"><span class="pill status-good">Active reviewer</span> <span class="muted">${escapeHtml(profile.reviewer_kind || "earned")} · <a href="${href("/reviewers")}">roster</a></span></p>
                </div>`
              : ""
          }
        </div>
      </header>
      ${suspendHtml}
      ${muteHtml}
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${linksHtml}
      ${orgsHtml}
      ${impactHtml}
      ${claimStatsHtml ? `<h2 class="section-title">Claim record</h2>${claimStatsHtml}` : ""}
      <h2 class="section-title">Proposals</h2>
      ${workHtml}
    </section>
  `);
  void hydrateAvatarSlots(app);
}
