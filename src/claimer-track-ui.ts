import type { AuthUser } from "./auth";
import type {
  ClaimApplicationsResponse,
  ClaimStatus,
  TrackEntry,
} from "./builder";
import { cachedProposalTitle } from "./github";
import { mempoolWeb } from "./config";
import { avatarSlotHtml, orgAvatarSlotHtml } from "./profile-avatars";
import { orgHref, profileHref, proposalHref } from "./router";
import { relativeTimeLeft } from "./claim-mode-ui";
import { html, raw } from "./util";

function githubUserHref(login: string): string {
  return `https://github.com/${encodeURIComponent(login.replace(/^@/, ""))}`;
}

function mempoolTxUrl(txid: string): string {
  return `${mempoolWeb()}/tx/${txid}`;
}

function trackLinkHtml(row: TrackEntry): string {
  const title = cachedProposalTitle(row.proposal_id) || row.proposal_id;
  const href = proposalHref(row.proposal_path || "", row.proposal_id);
  return html`<a class="track-link" href="${href}">${title}</a>`.value;
}

function otherResultsHtml(rows: TrackEntry[]): string {
  const rejected = rows.filter((r) => r.outcome === "rejected").length;
  const expired = rows.filter((r) => r.outcome === "expired").length;
  const abandoned = rows.filter((r) => r.outcome === "abandoned").length;
  const bits: string[] = [];
  if (rejected) bits.push(`${rejected} not accepted`);
  if (expired) bits.push(`${expired} window expired`);
  if (abandoned) bits.push(`${abandoned} left unfinished`);
  if (!bits.length) return "";
  return html`<span class="track-other muted">${bits.join(" · ")}</span>`.value;
}

function builderTrackInner(track: TrackEntry[] | undefined, limit: number): string {
  const rows = track || [];
  const shipped = rows.filter((r) => r.outcome === "completed");
  const others = otherResultsHtml(rows);
  if (!shipped.length && !others) {
    return html`<span class="track-empty muted">No shipped projects yet</span>`.value;
  }
  const shown = raw(shipped.slice(0, limit).map(trackLinkHtml).join(""));
  const rest = shipped.slice(limit);
  const more = rest.length
    ? html`<details class="track-more"><summary>${rest.length} more</summary>${raw(rest.map(trackLinkHtml).join(""))}</details>`
    : raw("");
  return html`<span class="track-shipped">${shown}</span>${more}${raw(others)}`.value;
}

function applicantTrackHtml(
  s: {
    active: number;
    completed: number;
    expired: number;
    rejected: number;
    abandoned: number;
    track?: TrackEntry[];
  } | null,
): string {
  if (!s) return "";
  return html`<div class="claimer-track">${raw(builderTrackInner(s.track, 3))}</div>`.value;
}

/** Linked claimer label (org → /org, individual → /u or GitHub). */
export function claimerIdentityHtml(
  login: string,
  type?: string | null,
  agent?: string | null,
): string {
  const handle = login.replace(/^@/, "").trim();
  if (!handle) {
    return html`${login || "another builder"}`.value;
  }
  if (type === "org") {
    const agentBit = agent
      ? html` <span class="muted">(org · <a href="${githubUserHref(agent)}" target="_blank" rel="noreferrer">@${agent}</a>)</span>`
      : html` <span class="muted">(org)</span>`;
    return html`${raw(orgAvatarSlotHtml(handle))}<a href="${orgHref(handle)}"><strong>${handle}</strong></a>${agentBit}`.value;
  }
  return html`${raw(avatarSlotHtml(handle))}<a href="${profileHref(handle)}"><strong>${handle}</strong></a>`.value;
}

/** Shipped projects for the awarded builder (exported for unit tests). */
export function claimerTrackHtml(status: ClaimStatus): string {
  const s = status.claimer_summary;
  if (!s) return "";
  return html`<div class="claimer-track claimer-track-block">${raw(builderTrackInner(s.track, 5))}</div>`.value;
}

function relDeadlineHtml(iso: string): string {
  return html`<span data-rel-deadline="${iso}">${relativeTimeLeft(iso)}</span>`.value;
}

function earliestBondedLogin(apps: ClaimApplicationsResponse): string | null {
  const bonded = apps.applications
    .filter((a) => a.bond_status === "bonded")
    .slice()
    .sort((a, b) =>
      (a.bonded_at || a.applied_at).localeCompare(b.bonded_at || b.applied_at),
    );
  return bonded[0]?.claimer_login ?? null;
}

function claimAppRowHtml(
  apps: ClaimApplicationsResponse,
  a: ClaimApplicationsResponse["applications"][number],
): string {
  const bondPaid = a.bond_status === "bonded" || a.bond_status === "awarded";
  const bond = bondPaid
    ? a.claim_bond_txid
      ? html`<a class="claim-app-bond" href="${mempoolTxUrl(a.claim_bond_txid)}" target="_blank" rel="noreferrer">Bond paid</a>`
      : html`<span class="claim-app-bond">Bond paid</span>`
    : html`<span class="claim-app-bond is-pending">${a.bond_status.replace(/_/g, " ")}</span>`;
  const showProposer =
    Boolean(apps.is_proposer) &&
    apps.claim_mode === "proposer_select" &&
    a.bond_status === "bonded" &&
    !apps.awarded_application_id;
  const showWithdraw =
    Boolean(a.is_mine) && a.bond_status === "bonded" && !apps.awarded_application_id;
  const proposerActions = showProposer
    ? html`<button type="button" class="btn" data-accept-app="${a.id}">Award</button>
        <button type="button" class="btn ghost" data-reject-app="${a.id}">Reject</button>`
    : raw("");
  const mineWithdraw = showWithdraw
    ? html`<button type="button" class="btn ghost" data-withdraw-app="${a.id}">Withdraw</button>`
    : raw("");
  const actions =
    showProposer || showWithdraw
      ? html`<div class="claim-app-actions">${proposerActions}${mineWithdraw}</div>`
      : raw("");
  const you = a.is_mine
    ? html` <span class="claim-app-you muted">(you)</span>`
    : raw("");
  return html`<li class="claim-app-row">
    <div class="claim-app-main">
      <div class="claim-app-identity">${raw(claimerIdentityHtml(a.claimer_login, a.claimer_type, a.claim_agent))}${you}</div>
      ${raw(applicantTrackHtml(a.summary))}
      <div class="claim-app-meta">${bond}</div>
    </div>
    ${actions}
  </li>`.value;
}

/** Exported for unit tests (applicant list + proposer actions). */
export function applicationsPanelHtml(apps: ClaimApplicationsResponse): string {
  const modeLabel =
    apps.claim_mode === "first_bonded"
      ? "First bonded wins"
      : `Proposer picks · ${apps.claim_window_days}d window`;
  const bondedCount = Math.max(0, Number(apps.summary?.bonded) || 0);
  let timerHtml = raw("");
  if (
    bondedCount > 0 &&
    apps.claim_mode === "proposer_select" &&
    apps.phase === "collecting" &&
    apps.window_ends_at
  ) {
    timerHtml = html`<p class="claim-apps-deadline muted">Window closes ${raw(relDeadlineHtml(apps.window_ends_at))}</p>`;
  } else if (bondedCount > 0 && apps.phase === "grace" && apps.decision_ends_at) {
    timerHtml = html`<p class="claim-apps-deadline muted">Auto-award ${raw(relDeadlineHtml(apps.decision_ends_at))}</p>`;
  }
  const earliest = earliestBondedLogin(apps);
  let graceNote = raw("");
  if (apps.phase === "grace" && apps.claim_mode === "proposer_select") {
    if (earliest) {
      graceNote = apps.is_proposer
        ? html`<p class="claim-grace-note">Auto-awards <strong>@${earliest}</strong> unless you pick.</p>`
        : html`<p class="claim-grace-note muted">Auto-awards <strong>@${earliest}</strong> if no pick.</p>`;
    } else {
      graceNote = html`<p class="claim-grace-note muted">Decision window open — no bonded applicants to auto-award.</p>`;
    }
  }
  const visible = apps.applications.filter((a) =>
    ["bonded", "awarded"].includes(a.bond_status),
  );
  const countLabel =
    bondedCount > 0
      ? `${bondedCount} bonded`
      : visible.length > 0
        ? `${visible.length}`
        : "";
  const empty =
    visible.length === 0
      ? apps.phase === "grace" && !earliest
        ? raw("")
        : apps.phase === "grace"
          ? html`<p class="claim-apps-empty muted">No open applications.</p>`
          : html`<p class="claim-apps-empty muted">No applicants yet.</p>`
      : raw("");
  const rows =
    visible.length === 0
      ? empty
      : html`<ul class="claim-app-list">${raw(visible.map((a) => claimAppRowHtml(apps, a)).join(""))}</ul>`;
  const countBadge = countLabel
    ? html`<span class="claim-apps-count mono">${countLabel}</span>`
    : raw("");
  return html`<section class="claim-apps" id="claim-apps-panel" aria-labelledby="claim-apps-title">
    <header class="claim-apps-head">
      <div class="claim-apps-head-text">
        <h3 class="claim-apps-title" id="claim-apps-title">Applicants</h3>
        <p class="claim-apps-mode">${modeLabel}</p>
      </div>
      ${countBadge}
    </header>
    ${timerHtml}
    ${graceNote}
    ${rows}
  </section>`.value;
}

export function collaboratorsPanelHtml(
  apps: ClaimApplicationsResponse,
  user: AuthUser | null,
  canInvite: boolean,
): string {
  const list =
    apps.collaborators.length === 0
      ? html`<p class="builder-status muted">No credit collaborators yet.</p>`
      : html`<ul class="claim-app-list">${raw(
          apps.collaborators
            .map(
              (c) =>
                html`<li class="claim-app-row"><div><strong>@${c.github}</strong> · ${c.status}</div></li>`.value,
            )
            .join(""),
        )}</ul>`;
  const myGh = (user?.github || "").toLowerCase();
  const pendingForMe =
    myGh &&
    apps.collaborators.some(
      (c) => c.github.toLowerCase() === myGh && c.status === "pending",
    );
  const acceptBtn = pendingForMe
    ? html`<button type="button" class="btn" id="collab-accept">Accept credit invite</button>`
    : raw("");
  const invite = canInvite
    ? html`<div class="claim-collab-invite">
        <label class="donate-amount-label" for="collab-search">Credit a collaborator (GitHub)</label>
        <p class="builder-claim-hint muted">Credit-only — they don’t operate the claim or earn completion badges.</p>
        <input id="collab-search" class="donate-amount mono" type="search" placeholder="Search GitHub users…" autocomplete="off" />
        <div id="collab-suggestions" class="claim-collab-suggestions"></div>
        <div id="collab-following" class="claim-collab-following"></div>
      </div>`
    : raw("");
  return html`<section class="claim-collab" id="claim-collab-panel" aria-labelledby="claim-collab-title">
    <header class="claim-apps-head">
      <div class="claim-apps-head-text">
        <h3 class="claim-apps-title" id="claim-collab-title">Collaborators</h3>
        <p class="claim-apps-mode">Credit only</p>
      </div>
    </header>
    ${list}
    ${acceptBtn}
    ${invite}
  </section>`.value;
}
