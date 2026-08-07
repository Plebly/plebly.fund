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

export type FetchPublicOrgResult =
  | { status: "ok"; org: PublicOrg; can_resync: boolean }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export async function fetchPublicOrg(
  login: string,
): Promise<FetchPublicOrgResult> {
  if (!WORKERS_API) {
    return { status: "unavailable", message: "API not configured" };
  }
  const res = await authFetch(
    `${API()}/orgs/${encodeURIComponent(login.replace(/^@/, "").trim())}`,
  );
  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) {
    let message = `Org service error (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    return { status: "unavailable", message };
  }
  const data = (await res.json()) as {
    org?: PublicOrg;
    can_resync?: boolean;
  };
  if (!data.org?.login) return { status: "not_found" };
  return {
    status: "ok",
    org: data.org,
    can_resync: Boolean(data.can_resync),
  };
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

function orgDisplayTitle(org: PublicOrg): string {
  const name = org.name?.trim();
  if (name) return name;
  return org.login.replace(/^@/, "").trim();
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
      ? `<p class="muted">No public members yet. On GitHub, org members must set their membership to <strong>Public</strong> under <a href="${escapeHtml(org.html_url)}/people" target="_blank" rel="noreferrer">People</a> before they appear here.</p>`
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
                  <span>${escapeHtml(login)}</span>
                </a>
              </li>`;
          })
          .join("")}</ul>`;

  const synced = relativeSynced(org.synced_at);
  const title = orgDisplayTitle(org);
  return `
      <header class="profile-hero profile-hero-org">
        ${
          org.avatar_url
            ? `<div class="profile-hero-avatar">
                <img class="avatar profile-hero-avatar-img" src="${escapeHtml(org.avatar_url)}" alt="" width="72" height="72" loading="lazy" />
              </div>`
            : ""
        }
        <div class="profile-hero-content">
          <div class="profile-hero-head">
            <h1>${escapeHtml(title)}</h1>
          </div>
        </div>
      </header>
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
      <div class="org-page-blocks">
        ${
          claimStatsHtml
            ? `<section class="org-page-block">
                <h2 class="section-title">Claim record</h2>
                ${claimStatsHtml}
              </section>`
            : ""
        }
        <section class="org-page-block">
          <h2 class="section-title">Public members</h2>
          ${members}
        </section>
        <section class="org-page-block">
          <h2 class="section-title">Proposed projects</h2>
          ${proposedHtml}
        </section>
        <section class="org-page-block">
          <h2 class="section-title">Claims on Plebly</h2>
          ${workHtml}
        </section>
      </div>
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
  if (result.status === "not_found") {
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
  if (result.status === "unavailable") {
    applySeo({
      title: `@${login} (org)`,
      description: "GitHub organization profile on Plebly.",
      path: `/org/${encodeURIComponent(login)}`,
      noindex: true,
    });
    app.innerHTML = shell(`
      <section class="wrap detail org-page">
        <h1>@${escapeHtml(login.replace(/^@/, ""))}</h1>
        <p class="form-msg error">${escapeHtml(result.message)}</p>
        <p class="muted">The org roster is temporarily unavailable. If you operate this site, check GitHub App secrets on <code class="mono">plebly-api</code>.</p>
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
        title: orgDisplayTitle(org),
        description:
          org.description?.trim().slice(0, 160) ||
          `GitHub organization ${orgDisplayTitle(org)} on Plebly.`,
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
