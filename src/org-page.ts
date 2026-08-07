/**
 * Public GitHub org profile: /org/:login
 */
import { authFetch, type AuthUser } from "./auth";
import { WORKERS_API } from "./config";
import {
  listAllPublicProposals,
  proposalsForOrgClaimer,
  proposalsForOrgProposer,
} from "./github";
import { hydrateAvatarSlots } from "./profile-avatars";
import {
  applySeo,
  href,
  orgHref,
  profileHref,
  proposalHref,
  seoForRoute,
} from "./router";
import type { ClaimSummary } from "./types";
import { escapeHtml } from "./util";

const API = () => WORKERS_API.replace(/\/$/, "");

export type PublicOrg = {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
  description: string | null;
  public_members: { login: string; avatar_url: string }[];
  synced_at: string;
  claim_summary?: ClaimSummary;
};

export async function fetchPublicOrg(
  login: string,
): Promise<{ org: PublicOrg; can_resync: boolean } | null> {
  if (!WORKERS_API) return null;
  const res = await authFetch(
    `${API()}/orgs/${encodeURIComponent(login.replace(/^@/, "").trim())}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    org?: PublicOrg;
    can_resync?: boolean;
  };
  if (!data.org?.login) return null;
  return { org: data.org, can_resync: Boolean(data.can_resync) };
}

export async function resyncPublicOrg(login: string): Promise<PublicOrg> {
  const res = await authFetch(
    `${API()}/orgs/${encodeURIComponent(login)}/resync`,
    { method: "POST" },
  );
  const data = (await res.json()) as { org?: PublicOrg; error?: string };
  if (!res.ok || !data.org) {
    throw new Error(data.error || `Resync failed (${res.status})`);
  }
  return data.org;
}

function relativeSynced(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(t).toLocaleDateString();
}

function orgPageInnerHtml(
  org: PublicOrg,
  canResync: boolean,
  proposedHtml: string,
  workHtml: string,
): string {
  const s = org.claim_summary;
  const claimStatsHtml = s
    ? `<div class="claim-summary">
        <span class="pill">Claims done ${s.completed}</span>
        <span class="pill">Active ${s.active}</span>
        <span class="pill">Expired ${s.expired}</span>
        <span class="pill">Abandoned ${s.abandoned}</span>
        <span class="pill">Rejected ${s.rejected}</span>
      </div>`
    : "";
  const members =
    org.public_members.length === 0
      ? `<p class="muted">No public members listed.</p>`
      : `<ul class="org-member-grid">${org.public_members
          .map((m) => {
            const login = m.login.replace(/^@/, "").trim();
            return `<li class="org-member-card">
                <a href="${profileHref(login)}">
                  ${
                    m.avatar_url
                      ? `<img class="avatar org-member-avatar" src="${escapeHtml(m.avatar_url)}" alt="" width="36" height="36" loading="lazy" />`
                      : `<span class="org-member-avatar-fallback" aria-hidden="true"></span>`
                  }
                  <span>@${escapeHtml(login)}</span>
                </a>
              </li>`;
          })
          .join("")}</ul>`;

  const synced = relativeSynced(org.synced_at);
  return `
      <div class="profile-header">
        ${
          org.avatar_url
            ? `<img class="avatar" src="${escapeHtml(org.avatar_url)}" alt="" width="64" height="64" />`
            : ""
        }
        <div>
          <h1>@${escapeHtml(org.login)}</h1>
          <p class="muted">
            <span class="pill">GitHub org</span>
            ${org.name ? ` · ${escapeHtml(org.name)}` : ""}
          </p>
          <p class="profile-links">
            <a href="${escapeHtml(org.html_url)}" target="_blank" rel="noreferrer">github.com/${escapeHtml(org.login)}</a>
          </p>
        </div>
      </div>
      ${
        org.description
          ? `<p class="profile-bio">${escapeHtml(org.description)}</p>`
          : ""
      }
      <p class="muted org-synced" id="org-synced">
        Members updated ${escapeHtml(synced || "recently")}
        ${
          canResync
            ? ` · <button type="button" class="btn ghost" id="org-resync-btn">Resync</button>`
            : ""
        }
      </p>
      <p class="form-msg" id="org-resync-msg" hidden></p>
      ${claimStatsHtml ? `<h2 class="section-title">Claim record</h2>${claimStatsHtml}` : ""}
      <h2 class="section-title">Public members</h2>
      ${members}
      <h2 class="section-title">Proposed projects</h2>
      ${proposedHtml}
      <h2 class="section-title">Claims on Plebly</h2>
      ${workHtml}
  `;
}

export async function renderPublicOrgProfile(
  shell: (inner: string) => string,
  login: string,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap detail"><p class="loading">Loading org…</p></section>
  `);

  const result = await fetchPublicOrg(login);
  if (!result) {
    applySeo({
      title: "Org not found",
      description: "This GitHub organization could not be found.",
      path: `/org/${encodeURIComponent(login)}`,
      noindex: true,
    });
    app.innerHTML = shell(`
      <section class="wrap detail">
        <h1>Org not found</h1>
        <p>No public org for <span class="mono">${escapeHtml(login)}</span>.</p>
        <p><a href="${href("/")}">Back to projects</a></p>
      </section>
    `);
    return;
  }

  let { org, can_resync: canResync } = result;
  void user;

  applySeo(
    seoForRoute(
      { name: "org", login: org.login },
      {
        title: `@${org.login} (org)`,
        description:
          org.description?.trim().slice(0, 160) ||
          `GitHub organization @${org.login} on Plebly.`,
      },
    ),
  );

  const all = await listAllPublicProposals();
  const proposed = proposalsForOrgProposer(all, org.login);
  const proposedHtml =
    proposed.length === 0
      ? `<div class="empty-state"><div class="empty-state-inner">
          <p class="empty-state-title">No proposals yet</p>
          <p class="empty-state-body">Projects listed by this organization will show here.</p>
        </div></div>`
      : `<ul class="work-list">${proposed
          .map(
            (p) =>
              `<li><a href="${proposalHref(p.path, p.id)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
          )
          .join("")}</ul>`;
  const work = proposalsForOrgClaimer(all, org.login);
  const workHtml =
    work.length === 0
      ? `<div class="empty-state"><div class="empty-state-inner">
          <p class="empty-state-title">No claims yet</p>
          <p class="empty-state-body">Projects claimed by this org will show here.</p>
        </div></div>`
      : `<ul class="work-list">${work
          .map(
            (p) =>
              `<li><a href="${proposalHref(p.path, p.id)}">${escapeHtml(p.title)}</a> <span class="pill">${escapeHtml(String(p.status))}</span></li>`,
          )
          .join("")}</ul>`;

  const paint = (next: PublicOrg, resync: boolean) => {
    org = next;
    canResync = resync;
    const section = app.querySelector(".profile-page");
    if (section) {
      section.innerHTML = orgPageInnerHtml(org, canResync, proposedHtml, workHtml);
    } else {
      app.innerHTML = shell(`
        <section class="wrap detail profile-page org-page">
          ${orgPageInnerHtml(org, canResync, proposedHtml, workHtml)}
        </section>
      `);
    }
    bindResync();
    void hydrateAvatarSlots(app);
  };

  const bindResync = () => {
    app.querySelector("#org-resync-btn")?.addEventListener("click", async () => {
      const btn = app.querySelector<HTMLButtonElement>("#org-resync-btn");
      const msg = app.querySelector<HTMLElement>("#org-resync-msg");
      if (btn) btn.disabled = true;
      try {
        const updated = await resyncPublicOrg(org.login);
        paint(updated, true);
        const m = app.querySelector<HTMLElement>("#org-resync-msg");
        if (m) {
          m.hidden = false;
          m.className = "form-msg success";
          m.textContent = "Org profile refreshed from GitHub.";
        }
      } catch (e) {
        if (msg) {
          msg.hidden = false;
          msg.className = "form-msg error";
          msg.textContent = (e as Error).message;
        }
        if (btn) btn.disabled = false;
      }
    });
  };

  paint(org, canResync);
}

/** Exported for tests. */
export function orgProfileShellHtml(org: PublicOrg, canResync: boolean): string {
  return orgPageInnerHtml(
    org,
    canResync,
    `<p class="muted">No proposals yet.</p>`,
    `<p class="muted">No claims yet.</p>`,
  );
}

export { orgHref };
