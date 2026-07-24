import {
  claimUsername,
  fetchPublicProfile,
  githubLoginUrl,
  profilePath,
  updateProfile,
  userLabel,
  type AuthUser,
} from "./auth";
import { listAllPublicProposals, proposalsForProfile } from "./github";
import type { ProfileLink } from "./types";
import { escapeHtml } from "./util";

export type ShellContext = {
  user: AuthUser | null;
  routeName: string;
  shell: (inner: string) => string;
  rerender: () => void;
};

function linkRowHtml(links: ProfileLink[]): string {
  return links
    .map(
      (l, i) => `
    <div class="link-row" data-index="${i}">
      <input type="text" class="link-label" placeholder="Label" value="${escapeHtml(l.label)}" maxlength="40" />
      <input type="url" class="link-url" placeholder="https://…" value="${escapeHtml(l.url)}" maxlength="300" />
      <button type="button" class="link-btn remove-link">Remove</button>
    </div>`,
    )
    .join("");
}

export async function renderAccount(ctx: ShellContext): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Account</h1>
        <p class="lede">Log in to claim a username and manage your profile.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl("#/account"))}">Log in with GitHub</a>
      </section>
    `);
    return;
  }

  const user = ctx.user;
  app.innerHTML = ctx.shell(`
    <section class="wrap detail account-page">
      <h1>Account</h1>
      ${user.username ? `<p class="lede">Public profile: <a href="${profilePath(user.username)}">${escapeHtml(profilePath(user.username))}</a></p>` : `<p class="lede">Claim a username for a custom profile URL at <span class="mono">#/u/yourname</span>.</p>`}

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
          <legend>Links</legend>
          <div id="links-list">${linkRowHtml(user.links?.length ? user.links : [{ label: "", url: "" }])}</div>
          <button type="button" class="btn ghost" id="add-link-btn">Add link</button>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Save profile</button>
        </div>
        <p class="form-msg" id="account-msg" hidden></p>
      </form>

      <div class="panel identity-panel">
        <div>GitHub: ${user.github ? `<a href="https://github.com/${escapeHtml(user.github)}" target="_blank" rel="noreferrer">@${escapeHtml(user.github)}</a>` : "—"}</div>
        <div>Display: ${escapeHtml(userLabel(user))}</div>
      </div>
    </section>
  `);

  const form = document.getElementById("account-form") as HTMLFormElement;
  const msg = document.getElementById("account-msg")!;
  const linksList = document.getElementById("links-list")!;

  document.getElementById("add-link-btn")?.addEventListener("click", () => {
    const rows = linksList.querySelectorAll(".link-row");
    if (rows.length >= 8) return;
    linksList.insertAdjacentHTML(
      "beforeend",
      `<div class="link-row" data-index="${rows.length}">
        <input type="text" class="link-label" placeholder="Label" maxlength="40" />
        <input type="url" class="link-url" placeholder="https://…" maxlength="300" />
        <button type="button" class="link-btn remove-link">Remove</button>
      </div>`,
    );
    bindLinkRemove();
  });

  function bindLinkRemove() {
    linksList.querySelectorAll(".remove-link").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".link-row")?.remove();
      });
    });
  }
  bindLinkRemove();

  document.getElementById("claim-username-btn")?.addEventListener("click", async () => {
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.hidden = false;
    msg.textContent = "Saving…";
    msg.className = "form-msg";
    const links: ProfileLink[] = [];
    linksList.querySelectorAll(".link-row").forEach((row) => {
      const label = (row.querySelector(".link-label") as HTMLInputElement).value.trim();
      const url = (row.querySelector(".link-url") as HTMLInputElement).value.trim();
      if (label && url) links.push({ label, url });
    });
    const bio = (document.getElementById("bio-input") as HTMLTextAreaElement).value;
    try {
      await updateProfile({ bio, links });
      msg.textContent = "Profile saved.";
      msg.className = "form-msg success";
      ctx.rerender();
    } catch (err) {
      msg.textContent = (err as Error).message;
      msg.className = "form-msg error";
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

  const linksHtml =
    profile.links && profile.links.length
      ? `<ul class="profile-links">${profile.links
          .map(
            (l) =>
              `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(l.label)}</a></li>`,
          )
          .join("")}</ul>`
      : "";

  const workHtml =
    work.length === 0
      ? `<p class="muted">No public proposals linked yet.</p>`
      : `<ul class="work-list">${work
          .map(
            (p) =>
              `<li><a href="#/proposal/${encodeURIComponent(p.path)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
          )
          .join("")}</ul>`;

  app.innerHTML = ctx.shell(`
    <section class="wrap detail profile-page">
      <div class="profile-header">
        ${profile.avatar_url ? `<img class="avatar" src="${escapeHtml(profile.avatar_url)}" alt="" width="72" height="72" />` : ""}
        <div>
          <h1>@${escapeHtml(profile.username || username)}</h1>
          ${profile.github ? `<div class="meta"><a href="https://github.com/${escapeHtml(profile.github)}" target="_blank" rel="noreferrer">github.com/${escapeHtml(profile.github)}</a></div>` : ""}
        </div>
      </div>
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${linksHtml}
      <h2 class="section-title">Proposals & bounties</h2>
      ${workHtml}
    </section>
  `);
}
