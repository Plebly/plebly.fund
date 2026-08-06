import {
  acceptClaimApplication,
  acceptClaimCollaboratorInvite,
  addWatch,
  claimWindowDaysLeft,
  fetchClaimApplications,
  fetchClaimParams,
  fetchClaimStatus,
  fetchGithubFollowing,
  inviteClaimCollaborator,
  isOpenToClaim,
  rejectClaimApplication,
  removeWatch,
  requestClaimExtension,
  searchGithubUsers,
  submitAbandonedChallenge,
  submitCheckpoint,
  submitClaim,
  submitDeliverable,
  withdrawClaimApplication,
  type ClaimApplicationsResponse,
  type ClaimParams,
  type ClaimStatus,
} from "./builder";
import {
  claimModeHeroChipHtml,
  relativeTimeLeft,
  refreshClaimModeChips,
  refreshRelDeadlines,
} from "./claim-mode-ui";
import { BITCOIN_NETWORK, WORKERS_API } from "./config";
import { CLAIM_BOND_SATS, CLAIM_FLOOR_SATS } from "./config";
import { authFetch, loginChoicesHtml } from "./auth";
import type { AuthUser } from "./auth";
import { bindFeePay, feePayHtml, type FeePayBinding } from "./fee-pay";
import { btnWithIcon, solidIcon } from "./icons";
import {
  avatarSlotHtml,
  hydrateAvatarSlots,
  orgAvatarSlotHtml,
} from "./profile-avatars";
import { href, orgHref, profileHref } from "./router";
import { userMatchesProposer } from "./proposal-ui";
import { aiReviewCardHtml } from "./review-panel";
import type { GithubOrgAttestation, Proposal } from "./types";
import { escapeHtml, formatSats } from "./util";

function githubUserHref(login: string): string {
  return `https://github.com/${encodeURIComponent(login.replace(/^@/, ""))}`;
}

/** Linked claimer label (org → /org, individual → /u or GitHub). */
export function claimerIdentityHtml(
  login: string,
  type?: string | null,
  agent?: string | null,
): string {
  const handle = login.replace(/^@/, "").trim();
  if (!handle) return escapeHtml(login || "another builder");
  if (type === "org") {
    const agentBit = agent
      ? ` <span class="muted">(org · <a href="${escapeHtml(githubUserHref(agent))}" target="_blank" rel="noreferrer">@${escapeHtml(agent)}</a>)</span>`
      : ` <span class="muted">(org)</span>`;
    return `${orgAvatarSlotHtml(handle)}<a href="${orgHref(handle)}"><strong>@${escapeHtml(handle)}</strong></a>${agentBit}`;
  }
  return `${avatarSlotHtml(handle)}<a href="${profileHref(handle)}"><strong>${escapeHtml(handle)}</strong></a>`;
}

function sessionIsClaimer(
  user: AuthUser | null,
  claimer: string | null | undefined,
  claimerType?: string | null,
): boolean {
  if (!user || !claimer) return false;
  if (
    claimer === user.username ||
    claimer === user.github ||
    claimer === user.id
  ) {
    return true;
  }
  if (claimerType === "org") {
    return Boolean(findFreshOrg(user, claimer));
  }
  return false;
}

function findFreshOrg(
  user: AuthUser,
  orgLogin: string,
): GithubOrgAttestation | null {
  const want = orgLogin.replace(/^@/, "").trim().toLowerCase();
  for (const o of freshLinkedOrgs(user)) {
    if (o.login.toLowerCase() === want) return o;
  }
  return null;
}

const ORG_ATTESTATION_MS = 90 * 86_400_000;

function freshLinkedOrgs(user: AuthUser | null): GithubOrgAttestation[] {
  if (!user?.id.startsWith("github:") || !user.github_orgs?.length) return [];
  const now = Date.now();
  return user.github_orgs.filter((o) => {
    const at = Date.parse(o.verified_at);
    return o.role === "admin" && Number.isFinite(at) && now - at <= ORG_ATTESTATION_MS;
  });
}

function deliverableFormHtml(): string {
  return `<div id="deliverable-form" class="deliverable-form">
    <label class="donate-amount-label" for="deliv-url">Deliverable URL</label>
    <input id="deliv-url" class="donate-amount" type="url" placeholder="https://…" />
    <label class="donate-amount-label" for="deliv-desc">Description</label>
    <textarea id="deliv-desc" class="donate-amount" rows="3" placeholder="What to review…"></textarea>
    <label class="donate-amount-label" for="deliv-hash">Artifact hash (optional)</label>
    <input id="deliv-hash" class="donate-amount mono" type="text" />
    <button type="button" class="btn" id="deliv-submit">Submit for review</button>
    <div id="deliverable-ai-result" class="deliverable-ai-result" hidden></div>
  </div>`;
}

function watchBtnHtml(watching: boolean): string {
  return watching
    ? btnWithIcon("eye-slash", "Unwatch")
    : btnWithIcon("eye", "Watch");
}

function claimBtnHtml(disabled = false): string {
  return `<button type="button" class="btn" id="builder-claim"${disabled ? " disabled" : ""}>${btnWithIcon("handshake", "Apply with bond")}</button>`;
}

function mempoolTxUrl(txid: string): string {
  const base =
    BITCOIN_NETWORK === "mainnet"
      ? "https://mempool.space/tx/"
      : "https://mempool.space/signet/tx/";
  return `${base}${txid}`;
}

function applicantTrackHtml(s: {
  active: number;
  completed: number;
  expired: number;
  rejected: number;
  abandoned: number;
} | null): string {
  if (!s) return "";
  const submitted = s.active + s.completed + s.expired + s.rejected + s.abandoned;
  const failed = s.expired + s.abandoned + s.rejected;
  if (submitted === 0) return `<span class="claimer-track muted">First claim</span>`;
  const denom = s.completed + failed;
  const rate = denom > 0 ? Math.round((s.completed / denom) * 100) : 0;
  return `<span class="claimer-track mono muted">${submitted} claims · ${s.completed} completed · ${failed} failed · ${rate}%</span>`;
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

function relDeadlineHtml(iso: string): string {
  return `<span data-rel-deadline="${escapeHtml(iso)}">${escapeHtml(relativeTimeLeft(iso))}</span>`;
}

/** Exported for unit tests (applicant list + proposer actions). */
export function applicationsPanelHtml(apps: ClaimApplicationsResponse): string {
  const modeLabel =
    apps.claim_mode === "first_bonded"
      ? "First bonded wins"
      : `Proposer picks · ${apps.claim_window_days}d window`;
  let timer = "";
  if (apps.claim_mode === "proposer_select" && apps.phase === "collecting" && apps.window_ends_at) {
    timer = ` · until ${escapeHtml(new Date(apps.window_ends_at).toUTCString())} (${relDeadlineHtml(apps.window_ends_at)})`;
  } else if (apps.phase === "grace" && apps.decision_ends_at) {
    timer = ` · auto-award ${escapeHtml(new Date(apps.decision_ends_at).toUTCString())} (${relDeadlineHtml(apps.decision_ends_at)})`;
  }
  const earliest = earliestBondedLogin(apps);
  let graceNote = "";
  if (apps.phase === "grace" && apps.claim_mode === "proposer_select") {
    if (earliest) {
      graceNote = apps.is_proposer
        ? `<p class="builder-status claim-grace-note">Auto-awards <strong>@${escapeHtml(earliest)}</strong> unless you pick.</p>`
        : `<p class="builder-status claim-grace-note muted">Auto-awards <strong>@${escapeHtml(earliest)}</strong> if no pick.</p>`;
    } else {
      graceNote = `<p class="builder-status claim-grace-note muted">Decision window open — no bonded applicants to auto-award.</p>`;
    }
  }
  const visible = apps.applications.filter((a) =>
    ["pending_bond", "bonded", "awarded"].includes(a.bond_status),
  );
  const rows =
    visible.length === 0
      ? apps.phase === "grace"
        ? `<p class="builder-status muted">No open applications.</p>`
        : `<p class="builder-status muted">No applicants yet.</p>`
      : `<ul class="claim-app-list">${visible
          .map((a) => {
            const bond =
              a.bond_status === "bonded" || a.bond_status === "awarded"
                ? a.claim_bond_txid
                  ? `<a href="${escapeHtml(mempoolTxUrl(a.claim_bond_txid))}" target="_blank" rel="noreferrer">Bond paid</a>`
                  : "Bond paid"
                : a.bond_status === "pending_bond"
                  ? "Awaiting bond"
                  : escapeHtml(a.bond_status.replace(/_/g, " "));
            const proposerActions =
              apps.is_proposer &&
              apps.claim_mode === "proposer_select" &&
              a.bond_status === "bonded" &&
              !apps.awarded_application_id
                ? `<button type="button" class="btn" data-accept-app="${escapeHtml(a.id)}">Accept</button>
                    <button type="button" class="btn ghost" data-reject-app="${escapeHtml(a.id)}">Reject</button>`
                : "";
            const mineWithdraw =
              a.is_mine &&
              (a.bond_status === "bonded" || a.bond_status === "pending_bond") &&
              !apps.awarded_application_id
                ? `<button type="button" class="btn ghost" data-withdraw-app="${escapeHtml(a.id)}">Withdraw</button>`
                : "";
            const actions =
              proposerActions || mineWithdraw
                ? `<span class="claim-app-actions">${proposerActions}${mineWithdraw}</span>`
                : "";
            return `<li class="claim-app-row">
              <div class="claim-app-identity">${claimerIdentityHtml(
                a.claimer_login,
                a.claimer_type,
                a.claim_agent,
              )}${a.is_mine ? ` <span class="muted">(you)</span>` : ""} · ${bond}<br/>${applicantTrackHtml(a.summary)}</div>
              ${actions}
            </li>`;
          })
          .join("")}</ul>`;
  return `<div class="claim-apps" id="claim-apps-panel">
    <p class="builder-status"><strong>${escapeHtml(modeLabel)}</strong>${timer}<br/>
    ${apps.summary.total} applicants · ${apps.summary.bonded} bonds confirmed · ${apps.summary.pending_bond} awaiting payment</p>
    ${graceNote}
    ${rows}
  </div>`;
}

function collaboratorsPanelHtml(
  apps: ClaimApplicationsResponse,
  user: AuthUser | null,
  canInvite: boolean,
): string {
  const list =
    apps.collaborators.length === 0
      ? `<p class="builder-status muted">No credit collaborators yet.</p>`
      : `<ul class="claim-app-list">${apps.collaborators
          .map(
            (c) =>
              `<li class="claim-app-row"><div><strong>@${escapeHtml(c.github)}</strong> · ${escapeHtml(
                c.status,
              )}</div></li>`,
          )
          .join("")}</ul>`;
  const myGh = (user?.github || "").toLowerCase();
  const pendingForMe =
    myGh &&
    apps.collaborators.some(
      (c) => c.github.toLowerCase() === myGh && c.status === "pending",
    );
  const acceptBtn = pendingForMe
    ? `<button type="button" class="btn" id="collab-accept">Accept credit invite</button>`
    : "";
  const invite = canInvite
    ? `<div class="claim-collab-invite">
        <label class="donate-amount-label" for="collab-search">Credit a collaborator (GitHub)</label>
        <p class="builder-claim-hint muted">Credit-only — they don’t operate the claim or earn completion badges.</p>
        <input id="collab-search" class="donate-amount mono" type="search" placeholder="Search GitHub users…" autocomplete="off" />
        <div id="collab-suggestions" class="claim-collab-suggestions"></div>
        <div id="collab-following" class="claim-collab-following"></div>
      </div>`
    : "";
  return `<div class="claim-collab" id="claim-collab-panel">
    <p class="builder-status"><strong>Collaborators</strong> (credit)</p>
    ${list}
    ${acceptBtn}
    ${invite}
  </div>`;
}

export function builderPanelHtml(
  p: Proposal,
  balance: number | undefined,
  watching: boolean,
): string {
  const floor = CLAIM_FLOOR_SATS;
  const bal = balance ?? p.balance_sats ?? 0;
  const need = Math.max(0, floor - bal);
  const open = isOpenToClaim({ ...p, balance_sats: bal }, floor);
  const isDirect = String(p.proposal_type || "bounty") === "direct";

  if (isDirect) {
    return `<div class="builder-panel" id="builder">
    <div class="builder-actions">
      <button type="button" class="btn ghost" id="builder-watch" data-watching="${watching ? "1" : "0"}">${watchBtnHtml(watching)}</button>
    </div>
    <div id="builder-body" class="builder-body">
      <p class="builder-status">This is a <strong>direct</strong> proposal: the proposer is the recipient. No claim bond. The proposer submits the deliverable when ready.</p>
      ${
        need > 0
          ? `<p class="builder-status muted">Needs ${formatSats(need)} more confirmed sats to reach the floor.</p>`
          : `<p class="builder-status">Floor met. Proposer may submit a deliverable.</p>`
      }
      <div id="direct-deliverable-slot"></div>
    </div>
    <p class="builder-msg" id="builder-msg" hidden></p>
  </div>`;
  }

  return `<div class="builder-panel" id="builder">
    <div class="builder-actions">
      <button type="button" class="btn ghost" id="builder-watch" data-watching="${watching ? "1" : "0"}">${watchBtnHtml(watching)}</button>
    </div>
    <div id="builder-body" class="builder-body">
      ${
        open
          ? claimBtnHtml()
          : need > 0
            ? `<p class="builder-status muted">Needs ${formatSats(need)} more confirmed sats to reach the claim floor.</p>`
            : `<p class="builder-status muted">Loading claim status…</p>`
      }
    </div>
    <p class="builder-msg" id="builder-msg" hidden></p>
    <div class="site-modal" id="builder-claim-modal" hidden>
      <div class="site-modal-backdrop" data-close-claim tabindex="-1" aria-hidden="true"></div>
      <div class="site-modal-card builder-claim-card" role="dialog" aria-modal="true" aria-labelledby="claim-modal-title">
        <button type="button" class="site-modal-close" id="claim-close" aria-label="Close">${solidIcon("xmark")}</button>
        <h3 id="claim-modal-title">Apply with bond</h3>
        <p id="claim-modal-awareness" class="builder-claim-hint">Review current applicants before paying the bond.</p>

        <div class="claim-modal-section">
          <fieldset class="field">
            <span>Apply as</span>
            <label class="radio-row"><input type="radio" name="claimer_type" value="individual" checked /> Me (individual)</label>
            <label class="radio-row"><input type="radio" name="claimer_type" value="org" id="claimer-type-org" /> GitHub org (linked admin)</label>
            <div id="claim-org-slot" hidden>
              <div id="claim-org-preview" class="claim-org-preview"></div>
              <select id="claim-org-login" class="donate-amount mono" aria-label="Linked GitHub org">
                <option value="">Select a linked org…</option>
              </select>
              <p class="builder-claim-hint muted" id="claim-org-hint">
                Resync orgs on <a href="/account">Account</a> (GitHub <code>read:org</code>).
              </p>
            </div>
          </fieldset>
        </div>

        <div class="claim-modal-section">
          <label class="donate-amount-label" for="claim-payout">Payout address</label>
          <p class="builder-claim-hint muted">Where keyholders send escrow when they release it. Plebly never moves funds.</p>
          <input id="claim-payout" class="donate-amount mono" type="text" placeholder="bc1… or tb1…" />
        </div>

        <div class="claim-modal-section" id="claim-bond-slot"></div>

        <div class="claim-modal-section" id="claim-finalize" hidden>
          <label class="donate-amount-label" for="claim-note">Note (optional)</label>
          <input id="claim-note" class="donate-amount" type="text" maxlength="200" placeholder="Short note for reviewers" />
        </div>
        <p class="builder-msg" id="claim-modal-msg" hidden></p>
        <div class="donate-actions claim-modal-actions">
          <button type="button" class="btn" id="claim-confirm" hidden>Submit application</button>
          <button type="button" class="btn ghost" id="claim-cancel">Cancel</button>
        </div>
      </div>
    </div>
  </div>`;
}

function setMsg(el: HTMLElement | null, text: string | null, cls = ""): void {
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.className = "builder-msg";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `builder-msg ${cls}`.trim();
}

function setWatchBtn(btn: HTMLButtonElement, watching: boolean): void {
  btn.dataset.watching = watching ? "1" : "0";
  btn.innerHTML = watchBtnHtml(watching);
}

/** Informational claimer track record (exported for unit tests). */
export function claimerTrackHtml(status: ClaimStatus): string {
  const s = status.claimer_summary;
  if (!s) return "";
  const submitted =
    s.active + s.completed + s.expired + s.rejected + s.abandoned;
  const failed = s.expired + s.abandoned + s.rejected;
  if (submitted === 0) {
    return `<p class="claimer-track muted">First claim</p>`;
  }
  const denom = s.completed + failed;
  const rate =
    denom > 0 ? Math.round((s.completed / denom) * 100) : 0;
  return `<p class="claimer-track mono muted">${submitted} claims · ${s.completed} completed · ${failed} failed · ${rate}%</p>`;
}

function metaBits(status: ClaimStatus): string {
  const bits: string[] = [];
  if (status.proposer_claimed) {
    bits.push(`<span class="pill pill-status status-active">Proposer-claimed</span>`);
  }
  if (status.claim_bond_txid) {
    bits.push(
      `<span class="builder-meta">Bond locked · <code class="mono">${escapeHtml(status.claim_bond_txid.slice(0, 12))}…</code></span>`,
    );
  }
  if (status.checkpoint_due_at) {
    const due = new Date(status.checkpoint_due_at).toLocaleDateString();
    bits.push(
      status.checkpoint_url
        ? `<span class="builder-meta">Checkpoint filed</span>`
        : `<span class="builder-meta">Checkpoint due ${escapeHtml(due)}</span>`,
    );
  }
  return bits.length
    ? `<div class="builder-meta-row">${bits.join(" ")}</div>`
    : "";
}

function workboardSettingsHtml(enabled: boolean): string {
  return `<div class="workboard-settings" id="workboard-settings">
    <label class="radio-row workboard-toggle">
      <input type="checkbox" id="workboard-enabled" ${enabled ? "checked" : ""} />
      Workboard for claim team
    </label>
    <p class="builder-claim-hint muted">Non-public discussion for proposer, claimer, and collaborators. Default on.</p>
  </div>`;
}

async function bindWorkboardSettings(
  root: ParentNode,
  proposalId: string,
  isProposer: boolean,
  state: string,
): Promise<void> {
  const host = root.querySelector<HTMLElement>("#workboard-settings-host");
  if (
    !host ||
    !isProposer ||
    !WORKERS_API ||
    !(state === "claimed" || state === "in_review" || state === "completed")
  ) {
    return;
  }
  const api = WORKERS_API.replace(/\/$/, "");
  let enabled = true;
  try {
    const metaRes = await authFetch(
      `${api}/workboard/${encodeURIComponent(proposalId)}/meta`,
    );
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        enabled?: boolean;
        is_participant?: boolean;
      };
      if (typeof meta.enabled === "boolean") enabled = meta.enabled;
    }
  } catch {
    /* default on */
  }
  host.innerHTML = workboardSettingsHtml(enabled);
  const checkbox = host.querySelector<HTMLInputElement>("#workboard-enabled");
  checkbox?.addEventListener("change", async () => {
    const next = Boolean(checkbox.checked);
    checkbox.disabled = true;
    try {
      const res = await authFetch(
        `${api}/workboard/${encodeURIComponent(proposalId)}/settings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        checkbox.checked = !next;
        throw new Error(data.error || "Could not update workboard.");
      }
      window.dispatchEvent(
        new CustomEvent("plebly:workboard-settings", {
          detail: { proposalId, enabled: next },
        }),
      );
    } catch {
      checkbox.checked = !next;
    } finally {
      checkbox.disabled = false;
    }
  });
}

function renderStatusBody(
  body: HTMLElement,
  status: ClaimStatus,
  user: AuthUser | null,
  proposalPath: string,
  isProposer = false,
): void {
  const days = claimWindowDaysLeft(
    status.claimed_at,
    status.claim_window_ends_at,
  );
  const isYou = sessionIsClaimer(user, status.claimer, status.claimer_type);
  const showWb =
    isProposer &&
    (status.state === "claimed" ||
      status.state === "in_review" ||
      status.state === "completed");
  const wbSlot = showWb
    ? `<div id="workboard-settings-host"></div>`
    : "";
  const meta = metaBits(status);
  const track = claimerTrackHtml(status);
  const claimerLabel = status.claimer
    ? claimerIdentityHtml(
        status.claimer,
        status.claimer_type,
        status.claim_agent,
      )
    : "another builder";
  const windowLabel =
    days != null
      ? ` · ${days} day${days === 1 ? "" : "s"} left`
      : "";
  const extensionTools = isYou
    ? `<div class="builder-extension">
        <button type="button" class="btn ghost" id="builder-request-extension">Request 30-day extension</button>
      </div>`
    : "";

  switch (status.state) {
    case "open":
      body.innerHTML = `${track}<div id="claim-apps-host"></div>${claimBtnHtml()}`;
      break;
    case "below_floor": {
      const need = Math.max(
        0,
        status.claim_floor_sats - (status.confirmed_balance_sats ?? 0),
      );
      body.innerHTML = `<p class="builder-status muted">Needs ${formatSats(need)} more confirmed sats to reach the claim floor.</p>`;
      break;
    }
    case "claim_pending":
      body.innerHTML = `${track}${meta}<p class="builder-status">Claim pending${
        status.pending?.pr_url
          ? ` · <a href="${escapeHtml(status.pending.pr_url)}" target="_blank" rel="noreferrer">PR</a>`
          : ""
      }. Exclusive after merge.</p>`;
      break;
    case "claimed":
      if (isYou) {
        body.innerHTML = `${track}${meta}<p class="builder-status">You claimed this project${windowLabel}.</p>
        <p class="builder-status muted" id="claim-award-reason"></p>
        ${wbSlot}
        <div id="claim-collab-host"></div>
        <div class="builder-claim-tools">
          <button type="button" class="btn ghost" id="builder-checkpoint">File checkpoint</button>
          <button type="button" class="btn" id="builder-deliverable">Submit deliverable</button>
        </div>
        ${extensionTools}
        <div id="checkpoint-form" class="deliverable-form" hidden>
          <label class="donate-amount-label" for="checkpoint-url">Progress URL</label>
          <input id="checkpoint-url" class="donate-amount" type="url" placeholder="https://…" />
          <button type="button" class="btn" id="checkpoint-submit">Save checkpoint</button>
        </div>
        ${deliverableFormHtml().replace(
          'class="deliverable-form"',
          'class="deliverable-form" hidden',
        )}`;
      } else {
        body.innerHTML = `${track}${meta}<p class="builder-status">Claimed by ${claimerLabel}${windowLabel}.</p>
        <p class="builder-status muted" id="claim-award-reason"></p>
        ${wbSlot}
        <div id="claim-collab-host"></div>
        <button type="button" class="btn ghost" id="builder-challenge" data-path="${escapeHtml(proposalPath)}">Challenge as abandoned</button>`;
      }
      break;
    case "in_review":
      body.innerHTML = `${track}${meta}<p class="builder-status">In review${
        status.claimer ? ` · fulfiller ${claimerLabel}` : ""
      }${windowLabel}. AI triage finished. Reviewers confirm in the panel below.</p>
      ${wbSlot}
      ${isYou ? extensionTools : ""}`;
      break;
    case "completed":
      body.innerHTML = `${track}${meta}<p class="builder-status">Completed${
        status.claimer ? ` · ${claimerLabel}` : ""
      }. Fulfiller earns a reviewer seat. Escrow release is by keyholders — Plebly never moves funds.</p>
      ${wbSlot}`;
      break;
    default:
      body.innerHTML = `<p class="builder-status muted">Not available for claim.</p>`;
  }
}

export async function bindBuilderPanel(
  root: ParentNode,
  opts: {
    proposal: Proposal;
    balance?: number;
    user: AuthUser | null;
    watching: boolean;
  },
): Promise<void> {
  const panel = root.querySelector("#builder");
  if (!panel) return;
  const body = panel.querySelector<HTMLElement>("#builder-body");
  const msg = panel.querySelector<HTMLElement>("#builder-msg");
  const watchBtn = panel.querySelector<HTMLButtonElement>("#builder-watch");
  const modal = panel.querySelector<HTMLElement>("#builder-claim-modal");
  const payoutInput = panel.querySelector<HTMLInputElement>("#claim-payout");
  const noteInput = panel.querySelector<HTMLInputElement>("#claim-note");
  const bondSlot = panel.querySelector<HTMLElement>("#claim-bond-slot");
  const finalize = panel.querySelector<HTMLElement>("#claim-finalize");
  const claimConfirm = panel.querySelector<HTMLButtonElement>("#claim-confirm");

  const requireLogin = (reason: string) => {
    if (msg) {
      msg.hidden = false;
      msg.className = "builder-msg";
      msg.innerHTML = loginChoicesHtml(reason);
    }
  };

  watchBtn?.addEventListener("click", async () => {
    if (!opts.user) {
      requireLogin("Sign in to watch this project.");
      return;
    }
    try {
      const watching = watchBtn.dataset.watching === "1";
      if (watching) {
        await removeWatch(opts.proposal.path);
        setWatchBtn(watchBtn, false);
        setMsg(msg, null);
      } else {
        await addWatch(opts.proposal.path);
        setWatchBtn(watchBtn, true);
        setMsg(msg, null);
      }
    } catch (e) {
      if ((e as Error).message === "login_required") {
        requireLogin("Sign in to watch this project.");
      } else setMsg(msg, (e as Error).message, "error");
    }
  });

  const bindDeliverable = (refresh?: () => Promise<void>) => {
    panel
      .querySelector("#builder-deliverable")
      ?.addEventListener("click", () => {
        const form = panel.querySelector<HTMLElement>("#deliverable-form");
        if (form) form.hidden = !form.hidden;
      });
    panel.querySelector("#deliv-submit")?.addEventListener("click", async () => {
      const url = (
        panel.querySelector("#deliv-url") as HTMLInputElement | null
      )?.value.trim();
      const description = (
        panel.querySelector("#deliv-desc") as HTMLTextAreaElement | null
      )?.value.trim();
      const hash = (
        panel.querySelector("#deliv-hash") as HTMLInputElement | null
      )?.value.trim();
      if (!url || !description) {
        setMsg(msg, "URL and description required.", "error");
        return;
      }
      setMsg(msg, "Running AI first-pass and opening PR…");
      try {
        const result = await submitDeliverable({
          proposal_path: opts.proposal.path,
          deliverable_url: url,
          description,
          artifact_hash: hash || undefined,
        });
        const aiSlot = panel.querySelector<HTMLElement>("#deliverable-ai-result");
        if (result.ai_review && aiSlot) {
          aiSlot.hidden = false;
          aiSlot.innerHTML = aiReviewCardHtml(result.ai_review);
        } else if (result.ai_review && body) {
          const wrap = document.createElement("div");
          wrap.id = "deliverable-ai-result";
          wrap.className = "deliverable-ai-result";
          wrap.innerHTML = aiReviewCardHtml(result.ai_review);
          body.appendChild(wrap);
        }
        const next =
          result.ai_review?.outcome === "fail"
            ? "Clear fail. Revise and resubmit."
            : result.decision_id
              ? "Reviewer ballot opened."
              : "Submitted.";
        setMsg(msg, `${next} PR: ${result.pr_url}`, "success");
        if (refresh) await refresh();
      } catch (e) {
        if ((e as Error).message === "login_required") {
          requireLogin("Sign in to submit a deliverable.");
        } else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

  const isDirect =
    String(opts.proposal.proposal_type || "bounty").toLowerCase() === "direct";
  if (isDirect) {
    const slot = panel.querySelector<HTMLElement>("#direct-deliverable-slot");
    const bal = opts.balance ?? opts.proposal.balance_sats ?? 0;
    const floorMet = bal >= CLAIM_FLOOR_SATS;
    const status = String(opts.proposal.status || "");
    const canSubmit = ["listed", "funding", "claimable", "in_review"].includes(
      status,
    );
    const isProposer = userMatchesProposer(opts.user, opts.proposal.proposer);
    if (slot) {
      if (!floorMet) {
        slot.innerHTML = "";
      } else if (!canSubmit) {
        slot.innerHTML = `<p class="builder-status muted">Deliverable not available in status ${escapeHtml(status)}.</p>`;
      } else if (!opts.user) {
        slot.innerHTML = `<p class="builder-status muted">Sign in as the proposer to submit a deliverable.</p>`;
      } else if (!isProposer) {
        slot.innerHTML = `<p class="builder-status muted">Only the proposer can submit the deliverable on a direct proposal.</p>`;
      } else {
        slot.innerHTML = `<button type="button" class="btn" id="builder-deliverable">Submit deliverable</button>
          ${deliverableFormHtml().replace(
            'class="deliverable-form"',
            'class="deliverable-form" hidden',
          )}`;
        bindDeliverable();
      }
    }
    return;
  }

  let params: ClaimParams = {
    claim_bond_sats: CLAIM_BOND_SATS,
    max_active_claims: 1,
    reclaim_cooldown_days: 30,
    checkpoint_day: 45,
    checkpoint_grace_days: 7,
    fee_address: null,
  };
  try {
    params = await fetchClaimParams();
  } catch {
    /* defaults */
  }

  let feePay: FeePayBinding | null = null;

  const syncClaimFeeStep = (step: "pay" | "txid") => {
    if (finalize) finalize.hidden = step !== "txid";
    if (claimConfirm) claimConfirm.hidden = step !== "txid";
  };

  const mountClaimFeePay = async () => {
    if (!bondSlot) return;
    feePay?.stop();
    bondSlot.innerHTML = feePayHtml({
      id: "claim-bond",
      amountSats: params.claim_bond_sats,
      address: params.fee_address,
      note: "Same address as the submission fee · refunded on completion · forfeited on expiry or abandoned checkpoint",
    });
    feePay = await bindFeePay(panel, "claim-bond", {
      onStep: syncClaimFeeStep,
    });
    syncClaimFeeStep("pay");
  };
  await mountClaimFeePay();

  if (payoutInput && opts.user?.payout_address) {
    payoutInput.value = opts.user.payout_address;
  }

  const syncHeroClaimChip = (apps: ClaimApplicationsResponse | null) => {
    const html = apps
      ? claimModeHeroChipHtml({
          ...opts.proposal,
          claim_mode: apps.claim_mode,
          claim_phase: apps.phase,
          claim_window_ends_at: apps.window_ends_at,
          claim_decision_ends_at: apps.decision_ends_at,
          claim_apps_total: apps.summary.total,
          claim_apps_bonded: apps.summary.bonded,
        })
      : claimModeHeroChipHtml(opts.proposal);
    const existing = document.querySelector("#proposal-claim-mode-chip");
    if (!html) {
      if (existing) {
        const prev = existing.previousElementSibling;
        if (prev?.classList.contains("proposal-meta-sep")) prev.remove();
        existing.remove();
      }
      return;
    }
    if (existing) {
      existing.outerHTML = html;
      return;
    }
    const meta = document.querySelector(".proposal-meta-line");
    if (!meta) return;
    const sep = `<span class="proposal-meta-sep" aria-hidden="true">·</span>`;
    const typeChip = [...meta.querySelectorAll(".proposal-meta-chip")].find(
      (el) => !el.classList.contains("proposal-tag"),
    );
    if (typeChip) {
      typeChip.insertAdjacentHTML("afterend", `${sep}${html}`);
    } else {
      meta.insertAdjacentHTML("beforeend", `${sep}${html}`);
    }
  };

  const bindApplicantActions = (apps: ClaimApplicationsResponse) => {
    panel.querySelectorAll<HTMLButtonElement>("[data-accept-app]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.acceptApp;
        if (!id) return;
        btn.disabled = true;
        try {
          const result = await acceptClaimApplication({
            proposal_path: opts.proposal.path,
            application_id: id,
          });
          setMsg(msg, `Awarded. Claim PR: ${result.pr_url}`, "success");
          await refreshStatus();
        } catch (e) {
          setMsg(msg, (e as Error).message, "error");
          btn.disabled = false;
        }
      });
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-reject-app]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.rejectApp;
        if (!id) return;
        btn.disabled = true;
        try {
          await rejectClaimApplication({
            proposal_path: opts.proposal.path,
            application_id: id,
          });
          setMsg(msg, "Applicant rejected; bond refundable.", "success");
          await refreshStatus();
        } catch (e) {
          setMsg(msg, (e as Error).message, "error");
          btn.disabled = false;
        }
      });
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-withdraw-app]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.withdrawApp;
        if (!id) return;
        if (
          !window.confirm(
            "Withdraw your application? Your bond becomes refundable.",
          )
        ) {
          return;
        }
        btn.disabled = true;
        try {
          await withdrawClaimApplication({
            proposal_path: opts.proposal.path,
            application_id: id,
          });
          setMsg(msg, "Application withdrawn; bond refundable.", "success");
          await refreshStatus();
        } catch (e) {
          if ((e as Error).message === "login_required") {
            requireLogin("Sign in to withdraw your application.");
          } else setMsg(msg, (e as Error).message, "error");
          btn.disabled = false;
        }
      });
    });
    void apps;
  };

  const inviteGithub = async (login: string) => {
    try {
      await inviteClaimCollaborator({
        proposal_path: opts.proposal.path,
        github: login,
      });
      setMsg(msg, `Invited @${login} for credit.`, "success");
      await refreshStatus();
    } catch (e) {
      if ((e as Error).message === "login_required") {
        requireLogin("Sign in to invite collaborators.");
      } else setMsg(msg, (e as Error).message, "error");
    }
  };

  const bindCollaboratorUi = async (
    apps: ClaimApplicationsResponse,
    canInvite: boolean,
  ) => {
    const host = body?.querySelector("#claim-collab-host");
    if (!host) return;
    host.innerHTML = collaboratorsPanelHtml(apps, opts.user, canInvite);
    host.querySelector("#collab-accept")?.addEventListener("click", async () => {
      try {
        await acceptClaimCollaboratorInvite({
          proposal_path: opts.proposal.path,
        });
        setMsg(msg, "Collaborator credit accepted.", "success");
        await refreshStatus();
      } catch (e) {
        if ((e as Error).message === "login_required") {
          requireLogin("Sign in with GitHub to accept.");
        } else setMsg(msg, (e as Error).message, "error");
      }
    });
    if (!canInvite) return;
    const search = host.querySelector<HTMLInputElement>("#collab-search");
    const suggestions = host.querySelector<HTMLElement>("#collab-suggestions");
    const followingEl = host.querySelector<HTMLElement>("#collab-following");
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    const renderHits = (
      el: HTMLElement | null,
      users: { login: string; avatar_url?: string }[],
      empty: string,
    ) => {
      if (!el) return;
      if (!users.length) {
        el.innerHTML = empty
          ? `<p class="muted" style="font-size:0.8125rem">${escapeHtml(empty)}</p>`
          : "";
        return;
      }
      el.innerHTML = users
        .map(
          (u) =>
            `<button type="button" class="btn ghost claim-collab-hit" data-gh="${escapeHtml(u.login)}">@${escapeHtml(u.login)}</button>`,
        )
        .join(" ");
      el.querySelectorAll<HTMLButtonElement>("[data-gh]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const gh = btn.dataset.gh;
          if (gh) void inviteGithub(gh);
        });
      });
    };
    if (followingEl && opts.user?.github) {
      const following = await fetchGithubFollowing();
      renderHits(followingEl, following.slice(0, 12), "");
    }
    search?.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const q = search.value.trim();
        if (q.length < 2) {
          if (suggestions) suggestions.innerHTML = "";
          return;
        }
        const users = await searchGithubUsers(q);
        renderHits(suggestions, users, "No users found");
      }, 250);
    });
  };

  const refreshStatus = async () => {
    const [status, apps] = await Promise.all([
      fetchClaimStatus(opts.proposal.path),
      fetchClaimApplications(opts.proposal.path),
    ]);
    syncHeroClaimChip(apps);
    if (status && body) {
      if (!status.claimer_type && opts.proposal.claimer_type) {
        status.claimer_type = opts.proposal.claimer_type;
      }
      if (!status.claim_agent && opts.proposal.claim_agent) {
        status.claim_agent = opts.proposal.claim_agent;
      }
      const isProposer = userMatchesProposer(
        opts.user,
        opts.proposal.proposer,
      );
      renderStatusBody(
        body,
        status,
        opts.user,
        opts.proposal.path,
        isProposer,
      );
      if (opts.proposal.id) {
        await bindWorkboardSettings(
          body,
          opts.proposal.id,
          isProposer,
          status.state,
        );
      }
      const host = body.querySelector("#claim-apps-host");
      if (host && apps && status.state === "open") {
        host.innerHTML = applicationsPanelHtml(apps);
        bindApplicantActions(apps);
      }
      void hydrateAvatarSlots(body);
      const claimBtn = body.querySelector<HTMLButtonElement>("#builder-claim");
      if (claimBtn && apps?.mine_application_id) {
        claimBtn.hidden = true;
      }
      if (apps?.award_reason) {
        const reasonEl = body.querySelector("#claim-award-reason");
        if (reasonEl) {
          const label =
            apps.award_reason === "proposer_accept"
              ? "Selected by proposer"
              : apps.award_reason === "auto_earliest_bonded"
                ? "Auto-awarded (earliest bond)"
                : apps.award_reason === "first_bonded"
                  ? "First bonded"
                  : apps.award_reason;
          reasonEl.textContent = label;
        }
      }
      if (apps && (status.state === "claimed" || status.state === "in_review")) {
        const isYou = sessionIsClaimer(
          opts.user,
          status.claimer,
          status.claimer_type,
        );
        await bindCollaboratorUi(apps, isYou);
      }
      const awareness = panel.querySelector("#claim-modal-awareness");
      if (awareness && apps) {
        const phaseBit =
          apps.phase === "grace" && apps.decision_ends_at
            ? ` · auto-award ${relativeTimeLeft(apps.decision_ends_at)}`
            : apps.window_ends_at
              ? ` · ${relativeTimeLeft(apps.window_ends_at)} in window`
              : "";
        awareness.textContent = `Mode: ${
          apps.claim_mode === "first_bonded" ? "first bonded wins" : "proposer picks"
        } · ${apps.summary.bonded} bonded · ${apps.summary.pending_bond} awaiting bond${phaseBit}. Continue?`;
      }
      bindClaimButton();
      bindDeliverable(refreshStatus);
      bindCheckpoint();
      bindChallenge();
      bindExtension();
    }
  };

  const tickDeadlines = () => {
    refreshRelDeadlines(panel);
    refreshClaimModeChips(document);
  };
  const deadlineTimer = window.setInterval(tickDeadlines, 60_000);
  const onTabVisible = () => {
    if (document.visibilityState !== "visible") return;
    tickDeadlines();
    // Avoid clobbering an open claim modal (re-render resets the panel body).
    if (modal && !modal.hidden) return;
    void refreshStatus();
  };
  document.addEventListener("visibilitychange", onTabVisible);
  window.addEventListener("focus", tickDeadlines);
  const stopLive = () => {
    window.clearInterval(deadlineTimer);
    document.removeEventListener("visibilitychange", onTabVisible);
    window.removeEventListener("focus", tickDeadlines);
  };
  // SPA navigations replace #app; clear timers when panel is gone.
  const detachObserver = new MutationObserver(() => {
    if (!document.contains(panel)) {
      stopLive();
      detachObserver.disconnect();
    }
  });
  detachObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const modalMsg = () => panel.querySelector<HTMLElement>("#claim-modal-msg");

  const closeClaimModal = () => {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    window.removeEventListener("keydown", onClaimEscape);
    setMsg(modalMsg(), null);
    feePay?.setStep("pay");
    // Keep watching while modal can reopen; remount resets on next open via setStep.
    panel.querySelector<HTMLButtonElement>("#builder-claim")?.focus();
  };

  const onClaimEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeClaimModal();
  };

  const openClaimModal = () => {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onClaimEscape);
    setMsg(modalMsg(), null);
    feePay?.setStep("pay");
    payoutInput?.focus();
  };

  const bindClaimButton = () => {
    panel.querySelector<HTMLButtonElement>("#builder-claim")?.addEventListener(
      "click",
      () => {
        if (!opts.user) {
          requireLogin("Sign in to claim this project.");
          return;
        }
        openClaimModal();
      },
    );
  };
  bindClaimButton();

  panel.querySelector("#claim-cancel")?.addEventListener("click", closeClaimModal);
  panel.querySelector("#claim-close")?.addEventListener("click", closeClaimModal);
  panel
    .querySelector("[data-close-claim]")
    ?.addEventListener("click", closeClaimModal);

  panel.querySelector("#claim-confirm")?.addEventListener("click", async () => {
    if (!opts.user) {
      requireLogin("Sign in to claim this project.");
      return;
    }
    const payout = payoutInput?.value.trim() || "";
    const bond = feePay?.getTxid() || "";
    if (!payout) {
      feePay?.setStep("pay");
      setMsg(modalMsg(), "Enter a payout address.", "error");
      payoutInput?.focus();
      return;
    }
    if (!bond || bond.length !== 64) {
      feePay?.setStep("txid");
      setMsg(modalMsg(), "Enter the 64-character claim bond txid.", "error");
      return;
    }
    const claimerType =
      (
        panel.querySelector(
          'input[name="claimer_type"]:checked',
        ) as HTMLInputElement | null
      )?.value === "org"
        ? ("org" as const)
        : ("individual" as const);
    const orgLogin =
      panel.querySelector<HTMLSelectElement>("#claim-org-login")?.value.trim() ||
      undefined;
    if (claimerType === "org" && !orgLogin) {
      setMsg(
        modalMsg(),
        "Select a linked GitHub org (or link one on Account).",
        "error",
      );
      return;
    }
    setMsg(modalMsg(), "Submitting bonded application…");
    try {
      const result = await submitClaim({
        proposal_path: opts.proposal.path,
        payout_address: payout,
        note: noteInput?.value.trim() || undefined,
        claim_bond_txid: bond,
        claimer_type: claimerType,
        org_login: claimerType === "org" ? orgLogin : undefined,
      });
      closeClaimModal();
      setMsg(
        msg,
        result.awarded && result.pr_url
          ? `Awarded. Claim PR: ${result.pr_url}`
          : `Application bonded. ${
              result.pr_url ? `PR: ${result.pr_url}` : "Awaiting proposer / auto-award."
            }`,
        "success",
      );
      await refreshStatus();
    } catch (e) {
      if ((e as Error).message === "login_required") {
        closeClaimModal();
        requireLogin("Sign in to apply for this project.");
      } else setMsg(modalMsg(), (e as Error).message, "error");
    }
  });

  const syncOrgSlot = () => {
    const org =
      (
        panel.querySelector(
          'input[name="claimer_type"]:checked',
        ) as HTMLInputElement | null
      )?.value === "org";
    const slot = panel.querySelector<HTMLElement>("#claim-org-slot");
    const select = panel.querySelector<HTMLSelectElement>("#claim-org-login");
    const hint = panel.querySelector<HTMLElement>("#claim-org-hint");
    const orgRadio = panel.querySelector<HTMLInputElement>("#claimer-type-org");
    const linked = freshLinkedOrgs(opts.user);
    if (orgRadio) {
      const canOrg = Boolean(opts.user?.id.startsWith("github:"));
      orgRadio.disabled = !canOrg;
      if (!canOrg && org) {
        const ind = panel.querySelector<HTMLInputElement>(
          'input[name="claimer_type"][value="individual"]',
        );
        if (ind) ind.checked = true;
      }
    }
    if (select) {
      const prev = select.value;
      select.innerHTML =
        `<option value="">Select a linked org…</option>` +
        linked
          .map(
            (o) =>
              `<option value="${escapeHtml(o.login)}"${
                o.login === prev ? " selected" : ""
              }>@${escapeHtml(o.login)}</option>`,
          )
          .join("");
    }
    const orgPreview = panel.querySelector<HTMLElement>("#claim-org-preview");
    if (orgPreview) {
      orgPreview.innerHTML = linked.length
        ? linked
            .map(
              (o) =>
                `<a class="claim-org-preview-item" href="${orgHref(o.login)}">${
                  o.avatar_url
                    ? `<img class="avatar" src="${escapeHtml(o.avatar_url)}" alt="" width="22" height="22" />`
                    : orgAvatarSlotHtml(o.login)
                }@${escapeHtml(o.login)}</a>`,
            )
            .join("")
        : "";
      void hydrateAvatarSlots(orgPreview);
    }
    if (hint) {
      hint.innerHTML = linked.length
        ? `Using orgs linked on <a href="${href("/account")}">Account</a>.`
        : opts.user?.id.startsWith("github:")
          ? `No linked orgs. <a href="${href("/account")}">Link GitHub orgs</a> on Account first.`
          : `Org apply requires a GitHub session. <a href="${href("/account")}">Account</a>`;
    }
    if (slot) {
      const showOrg =
        (
          panel.querySelector(
            'input[name="claimer_type"]:checked',
          ) as HTMLInputElement | null
        )?.value === "org";
      slot.hidden = !showOrg;
    }
  };
  panel.querySelectorAll('input[name="claimer_type"]').forEach((el) => {
    el.addEventListener("change", syncOrgSlot);
  });
  syncOrgSlot();

  const bindCheckpoint = () => {
    panel.querySelector("#builder-checkpoint")?.addEventListener("click", () => {
      const form = panel.querySelector<HTMLElement>("#checkpoint-form");
      if (form) form.hidden = !form.hidden;
    });
    panel.querySelector("#checkpoint-submit")?.addEventListener("click", async () => {
      const url = (
        panel.querySelector("#checkpoint-url") as HTMLInputElement | null
      )?.value.trim();
      if (!url?.startsWith("https://")) {
        setMsg(msg, "Checkpoint URL must be https://", "error");
        return;
      }
      try {
        await submitCheckpoint({
          proposal_path: opts.proposal.path,
          url,
        });
        setMsg(msg, "Checkpoint saved.", "success");
        await refreshStatus();
      } catch (e) {
        if ((e as Error).message === "login_required") requireLogin("Sign in to file a checkpoint.");
        else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

  const bindChallenge = () => {
    panel.querySelector("#builder-challenge")?.addEventListener("click", async () => {
      if (!opts.user) {
        requireLogin("Sign in to challenge this claim.");
        return;
      }
      const reason = window.prompt(
        "Why is this claim abandoned? (visible in challenge PR)",
        "No progress / missed checkpoint",
      );
      if (reason == null) return;
      setMsg(msg, "Opening abandoned-claim challenge…");
      try {
        const result = await submitAbandonedChallenge({
          proposal_path: opts.proposal.path,
          reason: reason.trim() || undefined,
        });
        setMsg(
          msg,
          result.pr_url
            ? `Challenge opened: ${result.pr_url}`
            : "Challenge recorded.",
          "success",
        );
      } catch (e) {
        if ((e as Error).message === "login_required") requireLogin("Sign in to challenge this claim.");
        else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

  const bindExtension = () => {
    panel
      .querySelector("#builder-request-extension")
      ?.addEventListener("click", async () => {
        if (!opts.user) {
          requireLogin("Sign in to request an extension.");
          return;
        }
        const btn = panel.querySelector<HTMLButtonElement>(
          "#builder-request-extension",
        );
        if (btn) btn.disabled = true;
        setMsg(msg, "Opening claim-extension ballot…");
        try {
          const result = await requestClaimExtension({
            proposal_path: opts.proposal.path,
          });
          setMsg(
            msg,
            `Extension ballot opened (${result.decision_id}). Reviewers vote on /reviewers and this project.`,
            "success",
          );
        } catch (e) {
          if (btn) btn.disabled = false;
          if ((e as Error).message === "login_required") {
            requireLogin("Sign in to request an extension.");
          } else setMsg(msg, (e as Error).message, "error");
        }
      });
  };

  try {
    await refreshStatus();
  } catch {
    /* keep static HTML */
  }
}
