import {
  claimUsername,
  fetchPublicProfile,
  githubLoginUrl,
  profilePath,
  updateProfile,
  type AuthUser,
} from "./auth";
import { socialAccountLink } from "./icons";
import { listAllPublicProposals, proposalsForProfile } from "./github";
import type { ProfileLink } from "./types";
import { escapeHtml, proposalHref } from "./util";

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
        <p class="lede">Sign in to claim a username and set up your profile.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl("#/account"))}">Log in</a>
      </section>
    `);
    return;
  }

  const user = ctx.user;
  app.innerHTML = ctx.shell(`
    <section class="wrap detail account-page">
      <h1>Account</h1>
      ${user.username ? `<p class="lede">Profile at <a href="${profilePath(user.username)}">#/u/${escapeHtml(user.username)}</a></p>` : `<p class="lede">Claim a username for your public profile URL.</p>`}

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

      <div class="identity-panel social-row">
        ${user.github ? socialAccountLink("github", `https://github.com/${user.github}`, user.github) : ""}
        ${user.x ? socialAccountLink("x-twitter", `https://x.com/${user.x.replace(/^@/, "")}`, user.x) : ""}
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
              `<li><a href="${proposalHref(p.path)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
          )
          .join("")}</ul>`;

  const socialHtml = [
    profile.github
      ? socialAccountLink("github", `https://github.com/${profile.github}`, profile.github)
      : "",
    profile.x
      ? socialAccountLink("x-twitter", `https://x.com/${profile.x.replace(/^@/, "")}`, profile.x)
      : "",
  ]
    .filter(Boolean)
    .join("");

  app.innerHTML = ctx.shell(`
    <section class="wrap detail profile-page">
      <div class="profile-header">
        ${profile.avatar_url ? `<img class="avatar" src="${escapeHtml(profile.avatar_url)}" alt="" width="64" height="64" />` : ""}
        <div>
          <h1>${escapeHtml(profile.username || username)}</h1>
          ${socialHtml ? `<div class="meta social-row">${socialHtml}</div>` : ""}
        </div>
      </div>
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${linksHtml}
      <h2 class="section-title">Work</h2>
      ${workHtml}
    </section>
  `);
}
