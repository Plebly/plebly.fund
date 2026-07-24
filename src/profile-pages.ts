import {
  claimUsername,
  deleteAccount,
  fetchPublicProfile,
  githubLoginUrl,
  profilePath,
  updateProfile,
  type AuthUser,
} from "./auth";
import { CLAIM_FLOOR_SATS } from "./config";
import {
  fetchMyPendingClaims,
  fetchWatches,
  isOpenToClaim,
} from "./builder";
import { socialAccountLink } from "./icons";
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
  const loginReturn = initialTab === "watching" ? "#/work" : "#/account";
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Work</h1>
        <p class="lede">Sign in to watch projects, claim funded work, and manage your profile.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl(loginReturn))}">Log in</a>
      </section>
    `);
    return;
  }

  const user = ctx.user;
  const tab: AccountTab = initialTab || "profile";
  const [watches, pendingClaims, allProps] = await Promise.all([
    fetchWatches().catch(() => []),
    fetchMyPendingClaims().catch(() => []),
    listListedProposals().catch(() => [] as Proposal[]),
  ]);
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
      <h1>${tab === "profile" ? "Account" : "Work"}</h1>
      ${user.username ? `<p class="lede">Profile at <a href="${profilePath(user.username)}">#/u/${escapeHtml(user.username)}</a></p>` : `<p class="lede">Claim a username for your public profile URL.</p>`}

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
          <p class="hint" id="username-hint">3–32 characters, lowercase letters, numbers, hyphens. First claim secures the name.</p>
        </fieldset>

        <fieldset class="form-block">
          <legend>Bio</legend>
          <textarea id="bio-input" rows="4" maxlength="500" placeholder="What you work on, Bitcoin interests…">${escapeHtml(user.bio || "")}</textarea>
        </fieldset>

        <fieldset class="form-block">
          <legend>Payout address</legend>
          <input id="payout-input" class="mono" type="text" value="${escapeHtml(user.payout_address || "")}" placeholder="bc1… or tb1…" maxlength="120" />
          <p class="hint">Used when you claim a project. You can override per claim.</p>
        </fieldset>

        <fieldset class="form-block">
          <legend>Links</legend>
          <p class="hint">Paste a profile URL. Labels are optional for GitHub, X, LinkedIn, and other supported social sites — those show as icons on your profile.</p>
          <div id="links-list">${linkRowHtml(user.links?.length ? user.links : [{ label: "", url: "" }])}</div>
          <button type="button" class="btn ghost" id="add-link-btn">Add link</button>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Save profile</button>
        </div>
        <p class="form-msg" id="account-msg" hidden></p>
      </form>

      <div class="identity-panel">
        <p class="hint identity-panel-label">Connected accounts</p>
        <div class="social-row identity-links">
          ${user.github ? socialAccountLink("github", `https://github.com/${user.github}`, user.github) : ""}
          ${user.x ? socialAccountLink("x-twitter", `https://x.com/${user.x.replace(/^@/, "")}`, user.x) : ""}
        </div>
      </div>

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
            ? `<p class="muted">No watched projects yet. Open a project and tap Watch.</p>`
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
        ${
          pendingClaims.length === 0
            ? `<p class="muted">No pending site claims. When a project is open to claim, use Claim on the project page.</p>
               <p class="hint">Exclusive lock starts when the claim PR merges in git.</p>`
            : `<ul class="work-list">${pendingClaims
                .map(
                  (c) => `<li>
                    <a href="${proposalHref(c.proposal_path)}">${escapeHtml(c.proposal_id)}</a>
                    <span class="pill">Pending</span>
                    ${
                      c.pr_url
                        ? `<a href="${escapeHtml(c.pr_url)}" target="_blank" rel="noreferrer">PR →</a>`
                        : ""
                    }
                  </li>`,
                )
                .join("")}</ul>`
        }
      </div>

      <div class="account-pane" data-pane="proposals" ${tab === "proposals" ? "" : "hidden"}>
        ${
          myProposals.length === 0
            ? `<p class="muted">No proposals linked to your identity yet.</p>`
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
      if (name === "watching" || name === "claims") {
        history.replaceState(null, "", "#/work");
      } else if (name === "profile") {
        history.replaceState(null, "", "#/account");
      }
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
      ? `<p class="muted">No public proposals linked yet.</p>`
      : `<ul class="work-list">${work
          .map(
            (p) =>
              `<li><a href="${proposalHref(p.path)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
          )
          .join("")}</ul>`;

  app.innerHTML = ctx.shell(`
    <section class="wrap detail profile-page">
      <div class="profile-header">
        ${profile.avatar_url ? `<img class="avatar" src="${escapeHtml(profile.avatar_url)}" alt="" width="64" height="64" />` : ""}
        <div>
          <h1>${escapeHtml(profile.username || username)}</h1>
        </div>
      </div>
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${linksHtml}
      <h2 class="section-title">Work</h2>
      ${workHtml}
    </section>
  `);
}
