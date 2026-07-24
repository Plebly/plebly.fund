import {
  claimUsername,
  deleteAccount,
  fetchPublicProfile,
  githubLoginUrl,
  profilePath,
  updateProfile,
  accountNavLabel,
  type AuthUser,
} from "./auth";
import { CLAIM_FLOOR_SATS } from "./config";
import {
  fetchMyClaims,
  fetchWatches,
  isOpenToClaim,
  type ClaimLedgerView,
} from "./builder";
import { btnWithBrandIcon, socialAccountLink } from "./icons";
import {
  listAllPublicProposals,
  listListedProposals,
  proposalsForProfile,
} from "./github";
import { addressBalanceSats } from "./mempool";
import { isKnownSocialUrl, profileLinksListHtml } from "./social-links";
import type { ProfileLink, Proposal } from "./types";
import { escapeHtml, formatSats, proposalHref } from "./util";

export type ShellContext = {
  user: AuthUser | null;
  routeName: string;
  shell: (inner: string) => string;
  rerender: () => void;
};

type AccountTab = "profile" | "watching" | "claims" | "proposals";

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
      <a class="btn ghost" href="#/">Browse projects</a>
    </div></div>`;
  }

  const pendingHtml =
    pending.length === 0
      ? ""
      : `<h3 class="section-title">Pending</h3><ul class="work-list">${pending
          .map(
            (c) => `<li>
              <a href="${proposalHref(c.proposal_path)}">${escapeHtml(c.proposal_id)}</a>
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
            <a href="${proposalHref(`proposals/listed/${b.proposal_id}.md`)}">${escapeHtml(b.proposal_id)}</a>
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

  return `${summaryHtml}
    ${pendingHtml}
    ${bonds}
    ${cooldowns}`;
}

function linkRowHtml(links: ProfileLink[]): string {
  return links
    .map(
      (l, i) => `
    <div class="link-row" data-index="${i}">
      <input type="text" class="link-label" placeholder="Custom label (optional)" value="${escapeHtml(l.label)}" maxlength="40" />
      <input type="url" class="link-url" placeholder="https://…" value="${escapeHtml(l.url)}" maxlength="300" />
      <button type="button" class="link-btn remove-link">Remove</button>
    </div>`,
    )
    .join("");
}

export async function renderAccount(
  ctx: ShellContext,
  initialTab?: AccountTab,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const loginReturn = "#/account";
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Account</h1>
        <p class="lede">Sign in with GitHub to watch projects, claim funded work, and manage your profile.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl(loginReturn))}">${btnWithBrandIcon("github", "Log in with GitHub")}</a>
      </section>
    `);
    return;
  }

  const user = ctx.user;
  const tab: AccountTab = initialTab || "profile";
  const [watches, myClaims, allProps] = await Promise.all([
    fetchWatches().catch(() => []),
    fetchMyClaims().catch(() => ({ pending: [], ledger: null })),
    listListedProposals().catch(() => [] as Proposal[]),
  ]);
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

  app.innerHTML = ctx.shell(`
    <section class="wrap detail account-page">
      <div class="account-head">
        <div>
          <h1>${escapeHtml(accountNavLabel(user))}</h1>
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
      </div>

      <div class="account-pane" data-pane="profile" ${tab === "profile" ? "" : "hidden"}>
      <form id="account-form" class="form-panel">
        <fieldset class="form-block">
          <legend>Username</legend>
          <div class="field-row">
            <span class="field-prefix">plebly.fund/u/</span>
            <input id="username-input" type="text" value="${escapeHtml(user.username || "")}" placeholder="yourname" pattern="[a-z0-9-]+" minlength="3" maxlength="32" ${user.username ? "readonly" : ""} />
            ${user.username ? "" : `<button type="button" class="btn" id="claim-username-btn">Claim</button>`}
          </div>
          <p class="hint" id="username-hint">3–32 characters · lowercase letters, numbers, hyphens</p>
        </fieldset>

        <fieldset class="form-block">
          <legend>Bio</legend>
          <textarea id="bio-input" rows="4" maxlength="500" placeholder="What you work on, Bitcoin interests…">${escapeHtml(user.bio || "")}</textarea>
        </fieldset>

        <fieldset class="form-block">
          <legend>Payout address</legend>
          <input id="payout-input" class="mono" type="text" value="${escapeHtml(user.payout_address || "")}" placeholder="bc1… or tb1…" maxlength="120" />
          <p class="hint">Default for claims; overrideable per claim.</p>
        </fieldset>

        <fieldset class="form-block">
          <legend>Links</legend>
          <div id="links-list">${linkRowHtml(user.links?.length ? user.links : [{ label: "", url: "" }])}</div>
          <button type="button" class="btn ghost" id="add-link-btn">Add link</button>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Save profile</button>
        </div>
        <p class="form-msg" id="account-msg" hidden></p>
      </form>

      ${
        user.github
          ? `<div class="identity-panel">
        <p class="hint identity-panel-label">Signed in with</p>
        <div class="social-row identity-links">
          ${socialAccountLink("github", `https://github.com/${user.github}`, user.github)}
        </div>
      </div>`
          : ""
      }

      <fieldset class="form-block danger-zone">
        <legend>Delete account</legend>
        <p class="hint">Permanently removes your profile, watch list, and saved settings. Your GitHub login can create a new profile later.</p>
        <button type="button" class="btn danger" id="delete-account-btn">Delete account</button>
        <p class="form-msg" id="delete-account-msg" hidden></p>
      </fieldset>
      </div>

      <div class="account-pane" data-pane="watching" ${tab === "watching" ? "" : "hidden"}>
        ${
          watchRows.length === 0
            ? `<div class="empty-state"><div class="empty-state-inner">
                <p class="empty-state-title">No watched projects</p>
                <p class="empty-state-body">Open a project and tap Watch to follow funding.</p>
                <a class="btn ghost" href="#/">Browse projects</a>
              </div></div>`
            : `<ul class="work-list">${watchRows
                .map(({ w, p, bal }) => {
                  const title = p?.title || w.proposal_id;
                  const href = proposalHref(w.proposal_path);
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
                <p class="empty-state-body">Describe the work and open a proposal PR.</p>
                <a class="btn ghost" href="#/propose">Start a project</a>
              </div></div>`
            : `<ul class="work-list">${myProposals
                .map(
                  (p) => `<li>
                    <a href="${proposalHref(p.path)}">${escapeHtml(p.title)}</a>
                    <span class="pill">${escapeHtml(String(p.status))}</span>
                  </li>`,
                )
                .join("")}</ul>`
        }
      </div>
    </section>
  `);

  app.querySelectorAll<HTMLButtonElement>(".account-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn.dataset.tab || "profile") as AccountTab;
      app.querySelectorAll(".account-tab").forEach((t) => {
        t.classList.toggle("active", t === btn);
      });
      app.querySelectorAll<HTMLElement>(".account-pane").forEach((pane) => {
        pane.hidden = pane.dataset.pane !== name;
      });
      history.replaceState(
        null,
        "",
        name === "profile" ? "#/account" : `#/account?tab=${name}`,
      );
    });
  });

  const form = document.getElementById("account-form") as HTMLFormElement | null;
  const msg = document.getElementById("account-msg");
  const linksList = document.getElementById("links-list");

  document.getElementById("add-link-btn")?.addEventListener("click", () => {
    if (!linksList) return;
    const rows = linksList.querySelectorAll(".link-row");
    if (rows.length >= 8) return;
    linksList.insertAdjacentHTML(
      "beforeend",
      `<div class="link-row" data-index="${rows.length}">
        <input type="text" class="link-label" placeholder="Custom label (optional)" maxlength="40" />
        <input type="url" class="link-url" placeholder="https://…" maxlength="300" />
        <button type="button" class="link-btn remove-link">Remove</button>
      </div>`,
    );
    bindLinkRemove();
  });

  function bindLinkRemove() {
    linksList?.querySelectorAll(".remove-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".link-row")?.remove();
      });
    });
  }
  bindLinkRemove();

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
        if (!label && !url) return;
        if (!url) {
          throw new Error("Each link needs a URL.");
        }
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
      await updateProfile({ bio, links, payout_address });
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
      location.hash = "#/";
      ctx.rerender();
    } catch (err) {
      if (deleteMsg) {
        deleteMsg.textContent = (err as Error).message;
        deleteMsg.className = "form-msg error";
      }
    }
  });
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
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Profile not found</h1>
        <p>No profile for <span class="mono">${escapeHtml(username)}</span>.</p>
      </section>
    `);
    return;
  }

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
              `<li><a href="${proposalHref(p.path)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
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

  app.innerHTML = ctx.shell(`
    <section class="wrap detail profile-page">
      <div class="profile-header">
        ${profile.avatar_url ? `<img class="avatar" src="${escapeHtml(profile.avatar_url)}" alt="" width="64" height="64" />` : ""}
        <div>
          <h1>${escapeHtml(profile.username || username)}</h1>
        </div>
      </div>
      ${suspendHtml}
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${linksHtml}
      ${claimStatsHtml ? `<h2 class="section-title">Claim record</h2>${claimStatsHtml}` : ""}
      <h2 class="section-title">Proposals</h2>
      ${workHtml}
    </section>
  `);
}
