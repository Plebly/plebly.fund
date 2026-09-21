import {
  ABOUT_BITCOIN_NETWORK,
  ABOUT_INTRO_HTML,
  ABOUT_LIGHTNING_HTML,
  ABOUT_PARAM_LABELS,
  ABOUT_STEPS,
} from "./generated/about-data";
import { PLEBLY_GITHUB_URL } from "./icons";
import { WORKERS_API } from "./config";
import { fetchPublicOrg, type PublicOrg } from "./org-page";
import { hydrateAvatarSlots } from "./profile-avatars";
import { href, orgHref, profileHref, projectsHref } from "./router";
import { signetFaucetLinksHtml } from "./signet";
import { avatarImgHtml } from "./media";
import { escapeHtml } from "./util";
import {
  KEYHOLDER_MIN_SEATS,
  KEYHOLDER_TARGET_SEATS,
  keyholderQuorumLabel,
} from "./keyholder-quorum";

export type AboutShell = (inner: string) => string;

/** Canonical GitHub org login for the platform team roster. */
export const PLEBLY_ORG_LOGIN = "Plebly";

function flowHtml(): string {
  if (!ABOUT_STEPS.length) return "";
  return `<ol class="about-flow">${ABOUT_STEPS.map(
    (s, i) => `<li>
      <span class="about-flow-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
      <span class="about-flow-title">${escapeHtml(s.title)}</span>
      <span class="about-flow-body">${escapeHtml(s.body)}</span>
    </li>`,
  ).join("")}</ol>`;
}

function feesHtml(): string {
  const want = new Set(["Platform fee", "Submission fee", "Opens for builders"]);
  const rows = ABOUT_PARAM_LABELS.filter((p) => want.has(p.label));
  if (!rows.length) return "";
  return `<dl class="about-params about-params-short">${rows
    .map(
      (p) => `<div class="about-param">
      <dt>${escapeHtml(p.label)}</dt>
      <dd>
        <span class="about-param-value">${escapeHtml(p.value)}</span>
        <span class="about-param-hint">${escapeHtml(p.hint)}</span>
      </dd>
    </div>`,
    )
    .join("")}</dl>`;
}

function networkNoteHtml(): string {
  if (ABOUT_BITCOIN_NETWORK !== "signet") return "";
  return `<div class="about-network-badge" role="status">
    <span class="about-network-badge-dot" aria-hidden="true"></span>
    <span>
      <strong>Signet</strong> · test coins only.
      Faucets: ${signetFaucetLinksHtml({ className: "signet-faucet-links" })}
    </span>
  </div>`;
}

/** Ops shorthand from KEYHOLDERS.md — hidden on the public About page (roster note covers it). */
export function publicKeyholderStatus(
  _status: string | undefined,
  rosterPublished: boolean,
  anyXpub: boolean,
): string | null {
  if (rosterPublished || anyXpub) return null;
  return null;
}

export function keyholdersHtml(live: {
  escrow_mode: string;
  keyholders: {
    github: string;
    xpub: string | null;
    fingerprint: string | null;
    signing_count?: number;
  }[];
  seats?: number;
  threshold?: number;
  quorum?: string;
  min_seats?: number;
  target_seats?: number;
}): string {
  const seated = live.keyholders.filter((k) => k.github?.trim());
  const n = seated.length;
  const min = live.min_seats ?? KEYHOLDER_MIN_SEATS;
  const target = live.target_seats ?? KEYHOLDER_TARGET_SEATS;
  const targetQuorum = keyholderQuorumLabel(target);
  const liveQuorum = n >= min ? keyholderQuorumLabel(n) : null;
  const lede = liveQuorum
    ? `Live <strong>${escapeHtml(liveQuorum)}</strong>. Target ${escapeHtml(targetQuorum)}.`
    : `Target <strong>${escapeHtml(targetQuorum)}</strong>.`;
  const status =
    n < min
      ? `<p class="about-keyholders-status" role="status">Need ${min} seats (${n} live). <a href="${href("/keyholders")}">Apply</a>.</p>`
      : "";
  const liveBody = seated.length
    ? `<div class="about-keyholders-table-wrap">
        <table class="about-keyholders-table">
          <thead><tr><th>Handle</th><th>Fingerprint</th></tr></thead>
          <tbody>${seated
            .map(
              (k) => `<tr>
            <td>${escapeHtml(k.github)}</td>
            <td class="mono">${escapeHtml(k.fingerprint || "—")}</td>
          </tr>`,
            )
            .join("")}</tbody>
        </table>
      </div>`
    : `<p class="muted">No live seats yet.</p>`;

  return `<section class="about-section" id="keyholders">
    <h2>Keyholders</h2>
    <p class="about-section-lede">${lede}</p>
    <p class="muted">After reviewers approve, keyholders sign the payout. If they stall, the site shows which seats have not signed. Plebly cannot move the coins.</p>
    ${status}
    <div class="about-keyholders-roster">
      ${liveBody}
      <p class="muted"><a href="${href("/keyholders")}">Apply</a> · <a href="${href("/keyholder-responsibilities")}">Responsibilities</a> · <a href="${href("/terms")}">Terms</a></p>
    </div>
  </section>`;
}

/** Public members of the Plebly GitHub org → Plebly `/u/` profiles. */
export function aboutTeamMembersHtml(
  members: { login: string; avatar_url: string }[],
): string {
  if (!members.length) {
    return `<p class="muted">No public members listed yet. On GitHub → <a href="${escapeHtml(PLEBLY_GITHUB_URL)}/people" target="_blank" rel="noreferrer">@${escapeHtml(PLEBLY_ORG_LOGIN)} People</a>, set membership to Public for anyone who should appear here.</p>`;
  }
  return `<ul class="org-member-grid about-team-grid">${members
    .map((m) => {
      const login = m.login.replace(/^@/, "").trim();
      return `<li class="org-member-card">
        <a href="${profileHref(login)}">
          ${
            m.avatar_url
              ? avatarImgHtml(m.avatar_url, "avatar org-member-avatar", 36)
              : `<span class="org-member-avatar-fallback" aria-hidden="true"></span>`
          }
          <span>${escapeHtml(login)}</span>
        </a>
      </li>`;
    })
    .join("")}</ul>`;
}

function teamSectionHtml(org: PublicOrg | null): string {
  const orgLink = org
    ? orgHref(org.login)
    : href(`/org/${encodeURIComponent(PLEBLY_ORG_LOGIN.toLowerCase())}`);
  const ghLink = org?.html_url || PLEBLY_GITHUB_URL;
  const members = org?.public_members ?? [];
  const body = org
    ? aboutTeamMembersHtml(members)
    : `<p class="muted"><a href="${orgLink}">Org page</a> · <a href="${escapeHtml(ghLink)}" target="_blank" rel="noreferrer">GitHub</a></p>`;

  return `<section class="about-section" id="team">
    <h2>Team</h2>
    ${body}
    <p class="about-section-foot"><a href="${orgLink}">Org page →</a></p>
  </section>`;
}

/** Scroll-spy TOC. Safe to call after each about render. */
export function bindAboutPage(root: ParentNode = document): () => void {
  const page = root.querySelector<HTMLElement>(".about-page");
  if (!page) return () => {};

  const sections = [
    ...page.querySelectorAll<HTMLElement>(".about-section[id]"),
  ];
  const links = [
    ...page.querySelectorAll<HTMLAnchorElement>(".about-toc-link"),
  ];
  if (!sections.length || !links.length) return () => {};

  const setActive = (id: string) => {
    for (const link of links) {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };

  const visible = new Map<string, number>();
  const tocObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.id;
        if (!id) continue;
        if (entry.isIntersecting) visible.set(id, entry.intersectionRatio);
        else visible.delete(id);
      }
      let bestId = "";
      let bestRatio = -1;
      for (const [id, ratio] of visible) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      if (bestId) setActive(bestId);
    },
    {
      rootMargin: "-20% 0px -55% 0px",
      threshold: [0, 0.15, 0.35, 0.55, 0.75],
    },
  );

  for (const section of sections) tocObserver.observe(section);

  const hashId = location.hash.replace(/^#/, "");
  if (hashId && sections.some((s) => s.id === hashId)) setActive(hashId);
  else if (sections[0]) setActive(sections[0].id);

  return () => {
    tocObserver.disconnect();
  };
}

export async function renderAbout(shell: AboutShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap-wide detail about-page">
      <p class="loading">Loading…</p>
    </section>
  `);

  const api = WORKERS_API.replace(/\/$/, "");
  const [orgResult, khLive, health] = await Promise.all([
    fetchPublicOrg(PLEBLY_ORG_LOGIN).catch(
      () =>
        ({ status: "unavailable", message: "network error" }) as const,
    ),
    fetch(`${api}/keyholders/public`)
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as {
              escrow_mode?: string;
              seats?: number;
              threshold?: number;
              quorum?: string;
              min_seats?: number;
              target_seats?: number;
              keyholders: {
                github: string;
                xpub: string | null;
                fingerprint: string | null;
                signing_count?: number;
              }[];
            })
          : null,
      )
      .catch(() => null),
    fetch(`${api}/health`)
      .then(async (r) =>
        r.ok ? ((await r.json()) as { escrow_mode?: string }) : null,
      )
      .catch(() => null),
  ]);
  const org = orgResult.status === "ok" ? orgResult.org : null;
  const liveKh = {
    escrow_mode: health?.escrow_mode || khLive?.escrow_mode || "unknown",
    keyholders: khLive?.keyholders || [],
    seats: khLive?.seats,
    threshold: khLive?.threshold,
    quorum: khLive?.quorum,
    min_seats: khLive?.min_seats,
    target_seats: khLive?.target_seats,
  };

  const lightning = ABOUT_LIGHTNING_HTML
    ? `<div class="about-prose prose-rich">${ABOUT_LIGHTNING_HTML}</div>`
    : "";

  app.innerHTML = shell(`
    <section class="wrap-wide detail about-page">
      <header class="about-hero">
        <h1>About Plebly</h1>
        <div class="about-lede prose-rich">${ABOUT_INTRO_HTML}</div>
        <div class="about-cta">
          <a class="btn" href="${projectsHref()}">Browse projects</a>
          <a class="btn ghost" href="${href("/propose")}">Start a project</a>
        </div>
        ${networkNoteHtml()}
      </header>

      <section class="about-section" id="how-it-works">
        <h2>How it works</h2>
        <p class="about-section-lede">Four steps. Funds stay on Bitcoin. Plebly never holds a spending key.</p>
        ${flowHtml()}
        <p class="about-section-foot">
          Reviewers confirm bounty work. A listed AI Reviewer, powered by BTCDecoded Intelligence, may analyze a deliverable against its spec. When confident it casts a decisive pass/fail vote; humans take over on escalate. It never releases funds.
          <a href="${href("/reviewer-responsibilities")}">Reviewer rules</a>
          ·
          <a href="${href("/reviewers")}">Roster</a>
        </p>
      </section>

      ${teamSectionHtml(org)}

      ${keyholdersHtml(liveKh)}

      <section class="about-section" id="parameters">
        <h2>Fees</h2>
        <p class="about-section-lede">Taken when a project is paid, not when you donate. <a href="${href("/parameters")}">All parameters</a> · <a href="${href("/terms")}">Terms</a>.</p>
        ${feesHtml()}
        ${lightning}
      </section>
    </section>
  `);

  bindAboutPage(app);
  void hydrateAvatarSlots(app);
}
