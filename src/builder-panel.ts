import {
  acceptClaimApplication,
  acceptClaimCollaboratorInvite,
  addWatch,
  applyClaimStatusToProposal,
  claimWindowDaysLeft,
  fetchClaimApplications,
  fetchClaimParams,
  fetchPayIntent,
  fetchClaimStatus,
  fetchGithubFollowing,
  fetchPayoutStatus,
  inviteClaimCollaborator,
  isOpenToClaim,
  rejectClaimApplication,
  removeWatch,
  requestClaimExtension,
  searchGithubUsers,
  flagProposalClose,
  markProposalDone,
  submitAbandonedChallenge,
  submitCheckpoint,
  submitClaim,
  submitDeliverable,
  withdrawClaimApplication,
  type ClaimApplicationsResponse,
  type ClaimParams,
  type ClaimStatus,
  type PayoutStatus,
} from "./builder";
import {
  claimModeHeroChipHtml,
  relativeTimeLeft,
  refreshClaimModeChips,
  refreshRelDeadlines,
} from "./claim-mode-ui";
import {
  CLAIM_BOND_SATS,
  CLAIM_FLOOR_SATS,
  WORKERS_API,
  addressHrp,
  escrowAddressMatchesNetwork,
  lightningUiAllowed,
  mempoolWeb,
  networkLabel,
  isFundableStatus,
} from "./config";
import { authFetch, loginChoicesHtml, updateProfile } from "./auth";
import type { AuthUser } from "./auth";
import { confirmAction, promptText } from "./confirm-modal";
import { runBusy } from "./form-busy";
import { bindFeePay, feePayHtml, type FeePayBinding } from "./fee-pay";
import { btnWithIcon, solidIcon } from "./icons";
import { safeHrefAttr } from "./social-links";
import {
  BOUNTY_ONCHAIN_PAYOUT_ERROR,
  isLightningPayoutDestination,
  payoutLooksValid,
  type PayoutRail,
} from "./payout-destination";
import {
  avatarSlotHtml,
  hydrateAvatarSlots,
  orgAvatarSlotHtml,
} from "./profile-avatars";
import { freshLinkedOrgs } from "./github-orgs-client";
import { avatarImgHtml } from "./media";
import { href, orgHref, profileHref } from "./router";
import { tosCheckboxHtml } from "./tos-modal";
import {
  claimStructuredState,
  nextActionCardHtml,
  nextActionMoreHtml,
  resolveNextAction,
} from "./next-action";
import { sessionMatchesClaimer, sessionMatchesPendingClaim } from "./claimer-match";
import {
  donateTriggerHtml,
  mountDonateChromeWhenEscrowKnown,
  setDonateChromeContext,
  bindDonateModal,
  proposalStepperHtml,
  statusPillHtml,
  userMatchesProposer,
} from "./proposal-ui";
import type { Proposal } from "./types";
import { sanitizePublicError } from "./public-errors";
import { escapeHtml, formatSats } from "./util";
import { fetchReviewerMe } from "./reviewers";

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
    return `${orgAvatarSlotHtml(handle)}<a href="${orgHref(handle)}"><strong>${escapeHtml(handle)}</strong></a>${agentBit}`;
  }
  return `${avatarSlotHtml(handle)}<a href="${profileHref(handle)}"><strong>${escapeHtml(handle)}</strong></a>`;
}

/** True when session is the claim ops agent (claimowner), not every org co-admin. */
export function sessionIsClaimer(
  user: AuthUser | null,
  claimer: string | null | undefined,
  claimerType?: string | null,
  claimAgent?: string | null,
  pendingUserId?: string | null,
): boolean {
  if (sessionMatchesPendingClaim(user, pendingUserId)) return true;
  return sessionMatchesClaimer(user, claimer, claimerType, claimAgent);
}

/** Prefer Workers claimer_user_id / pending.user_id when deciding fulfiller UI. */
export function sessionIsClaimStatusFulfiller(
  user: AuthUser | null,
  status: {
    claimer?: string | null;
    claimer_user_id?: string | null;
    claimer_type?: string | null;
    claim_agent?: string | null;
    pending?: { user_id?: string | null } | null;
  } | null | undefined,
): boolean {
  if (!status) return false;
  const full =
    status.claimer_user_id || status.pending?.user_id || null;
  return sessionIsClaimer(
    user,
    status.claimer,
    status.claimer_type,
    status.claim_agent,
    full,
  );
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
  </div>`;
}

function watchBtnHtml(watching: boolean): string {
  return watching
    ? btnWithIcon("eye-slash", "Unwatch")
    : btnWithIcon("eye", "Watch");
}

function formatUtcDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function payoutStatusCardHtml(s: PayoutStatus): string {
  const amount =
    typeof s.payout_sats === "number" ? formatSats(s.payout_sats) : "";
  const freeze = s.freeze_at ? formatUtcDay(s.freeze_at) : "";
  let body = "";
  if (s.state === "need_destination") {
    body = `Add a payout address in Account.`;
  } else if (s.state === "accruing") {
    body = `<strong>${escapeHtml(amount)}</strong> this month. Paid after ${escapeHtml(freeze)}.`;
  } else if (s.state === "frozen") {
    body = `This month’s payout is being signed.`;
  } else if (s.state === "settled") {
    const tx = s.settle_txid
      ? ` <a href="${escapeHtml(mempoolTxUrl(s.settle_txid))}" target="_blank" rel="noreferrer">View payment</a>`
      : "";
    body = `Paid.${tx}`;
  } else if (s.state === "blocked") {
    body = `Payout paused while donors vote.`;
  } else if (s.proposal_type === "bounty") {
    body = `Paid after the work is approved.`;
  } else {
    body = `Waiting on donations.`;
  }
  return `<section class="payout-status-card" aria-label="Next payout">
    <h3 class="payout-status-title">Next payout</h3>
    <p class="builder-status">${body}</p>
  </section>`;
}

function claimBtnHtml(disabled = false): string {
  return `<button type="button" class="btn" id="builder-claim"${disabled ? " disabled" : ""}>${btnWithIcon("handshake", "Apply with bond")}</button>`;
}

function mempoolTxUrl(txid: string): string {
  return `${mempoolWeb()}/tx/${txid}`;
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
  // Countdown only matters once someone is bonded — otherwise it reads like a
  // pick deadline with nothing to pick.
  const bondedCount = Math.max(0, Number(apps.summary?.bonded) || 0);
  let timerHtml = "";
  if (
    bondedCount > 0 &&
    apps.claim_mode === "proposer_select" &&
    apps.phase === "collecting" &&
    apps.window_ends_at
  ) {
    timerHtml = `<p class="claim-apps-deadline muted">Window closes ${relDeadlineHtml(apps.window_ends_at)}</p>`;
  } else if (bondedCount > 0 && apps.phase === "grace" && apps.decision_ends_at) {
    timerHtml = `<p class="claim-apps-deadline muted">Auto-award ${relDeadlineHtml(apps.decision_ends_at)}</p>`;
  }
  const earliest = earliestBondedLogin(apps);
  let graceNote = "";
  if (apps.phase === "grace" && apps.claim_mode === "proposer_select") {
    if (earliest) {
      graceNote = apps.is_proposer
        ? `<p class="claim-grace-note">Auto-awards <strong>@${escapeHtml(earliest)}</strong> unless you pick.</p>`
        : `<p class="claim-grace-note muted">Auto-awards <strong>@${escapeHtml(earliest)}</strong> if no pick.</p>`;
    } else {
      graceNote = `<p class="claim-grace-note muted">Decision window open — no bonded applicants to auto-award.</p>`;
    }
  }
  // Bond is verified at apply — ignore legacy pending_bond rows in the open list.
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
        ? "" // graceNote already covers “no bonded applicants”
        : apps.phase === "grace"
          ? `<p class="claim-apps-empty muted">No open applications.</p>`
          : `<p class="claim-apps-empty muted">No applicants yet.</p>`
      : "";
  const rows =
    visible.length === 0
      ? empty
      : `<ul class="claim-app-list">${visible
          .map((a) => {
            const bondPaid =
              a.bond_status === "bonded" || a.bond_status === "awarded";
            const bond = bondPaid
              ? a.claim_bond_txid
                ? `<a class="claim-app-bond" href="${escapeHtml(mempoolTxUrl(a.claim_bond_txid))}" target="_blank" rel="noreferrer">Bond paid</a>`
                : `<span class="claim-app-bond">Bond paid</span>`
              : `<span class="claim-app-bond is-pending">${escapeHtml(a.bond_status.replace(/_/g, " "))}</span>`;
            const proposerActions =
              apps.is_proposer &&
              apps.claim_mode === "proposer_select" &&
              a.bond_status === "bonded" &&
              !apps.awarded_application_id
                ? `<button type="button" class="btn" data-accept-app="${escapeHtml(a.id)}">Award</button>
                    <button type="button" class="btn ghost" data-reject-app="${escapeHtml(a.id)}">Reject</button>`
                : "";
            const mineWithdraw =
              a.is_mine &&
              a.bond_status === "bonded" &&
              !apps.awarded_application_id
                ? `<button type="button" class="btn ghost" data-withdraw-app="${escapeHtml(a.id)}">Withdraw</button>`
                : "";
            const actions =
              proposerActions || mineWithdraw
                ? `<div class="claim-app-actions">${proposerActions}${mineWithdraw}</div>`
                : "";
            const you = a.is_mine
              ? ` <span class="claim-app-you muted">(you)</span>`
              : "";
            return `<li class="claim-app-row">
              <div class="claim-app-main">
                <div class="claim-app-identity">${claimerIdentityHtml(
                  a.claimer_login,
                  a.claimer_type,
                  a.claim_agent,
                )}${you}</div>
                <div class="claim-app-meta">${bond}${applicantTrackHtml(a.summary)}</div>
              </div>
              ${actions}
            </li>`;
          })
          .join("")}</ul>`;
  return `<section class="claim-apps" id="claim-apps-panel" aria-labelledby="claim-apps-title">
    <header class="claim-apps-head">
      <div class="claim-apps-head-text">
        <h3 class="claim-apps-title" id="claim-apps-title">Applicants</h3>
        <p class="claim-apps-mode">${escapeHtml(modeLabel)}</p>
      </div>
      ${countLabel ? `<span class="claim-apps-count mono">${escapeHtml(countLabel)}</span>` : ""}
    </header>
    ${timerHtml}
    ${graceNote}
    ${rows}
  </section>`;
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
  return `<section class="claim-collab" id="claim-collab-panel" aria-labelledby="claim-collab-title">
    <header class="claim-apps-head">
      <div class="claim-apps-head-text">
        <h3 class="claim-apps-title" id="claim-collab-title">Collaborators</h3>
        <p class="claim-apps-mode">Credit only</p>
      </div>
    </header>
    ${list}
    ${acceptBtn}
    ${invite}
  </section>`;
}

export function builderPanelHtml(
  p: Proposal,
  balance: number | undefined,
  watching: boolean,
  user?: AuthUser | null,
): string {
  const first = resolveNextAction({
    proposal: { ...p, balance_sats: balance ?? p.balance_sats },
    user,
  });
  const isDirect = String(p.proposal_type || "bounty") === "direct";
  const firstPaint = `${nextActionCardHtml(first)}
      ${isDirect ? `<div id="direct-deliverable-slot"></div>` : `<div id="claim-apps-host"></div>`}`;

  if (isDirect) {
    return `<div class="builder-panel" id="builder">
    <div class="builder-actions">
      <button type="button" class="btn ghost next-card-watch" id="builder-watch" data-watching="${watching ? "1" : "0"}">${watchBtnHtml(watching)}</button>
    </div>
    <div id="payout-status-slot" class="payout-status-slot" hidden></div>
    <div id="builder-body" class="builder-body">
      ${firstPaint}
    </div>
    <p class="builder-msg" id="builder-msg" hidden></p>
    <div id="ai-review-slot" hidden></div>
  </div>`;
  }

  return `<div class="builder-panel" id="builder">
    <div class="builder-actions">
      <button type="button" class="btn ghost next-card-watch" id="builder-watch" data-watching="${watching ? "1" : "0"}">${watchBtnHtml(watching)}</button>
    </div>
    <div id="payout-status-slot" class="payout-status-slot" hidden></div>
    <div id="builder-body" class="builder-body">
      ${firstPaint}
    </div>
    <p class="builder-msg" id="builder-msg" hidden></p>
    <div id="ai-review-slot" hidden></div>
    <div class="site-modal" id="builder-claim-modal" hidden>
      <div class="site-modal-backdrop" data-close-claim tabindex="-1" aria-hidden="true"></div>
      <div class="site-modal-card builder-claim-card" role="dialog" aria-modal="true" aria-labelledby="claim-modal-title">
        <button type="button" class="site-modal-close" id="claim-close" aria-label="Close">${solidIcon("xmark")}</button>
        <h3 id="claim-modal-title">Apply with bond</h3>
        <p id="claim-modal-step" class="builder-claim-hint muted">Step 1 of 4 — Who</p>
        <p id="claim-modal-awareness" class="builder-claim-hint">Review current applicants before paying the bond.</p>

        <div class="claim-modal-section" id="claim-step-who">
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
                Resync orgs on <a href="${href("/account", "", "#account-orgs")}">Account</a> (GitHub <code>read:org</code>).
              </p>
            </div>
          </fieldset>
        </div>

        <div class="claim-modal-section claim-refund" id="claim-step-refund" hidden>
          <p class="claim-refund-lede" id="claim-payout-hint" tabindex="-1">
            One destination for bond refunds and, if you win and finish, escrow payout.
            Not the fee/bond pay address.
          </p>

          <div class="claim-refund-rules" role="group" aria-label="Bond refund conditions">
            <section class="claim-refund-rules-col" aria-labelledby="claim-refund-when-title">
              <h5 class="claim-refund-rules-title" id="claim-refund-when-title">Bond returned</h5>
              <ul class="claim-refund-list claim-refund-list-yes">
                <li>You withdraw before award</li>
                <li>Proposer rejects you</li>
                <li>Someone else is awarded</li>
                <li>You complete successfully</li>
              </ul>
            </section>
            <section class="claim-refund-rules-col" aria-labelledby="claim-refund-never-title">
              <h5 class="claim-refund-rules-title claim-refund-rules-title-warn" id="claim-refund-never-title">Bond forfeited</h5>
              <ul class="claim-refund-list claim-refund-list-no">
                <li>Claim window expires</li>
                <li>Checkpoint abandoned</li>
                <li>Final reject / rebuttal ends</li>
              </ul>
            </section>
          </div>

          <fieldset class="claim-refund-rail" id="claim-payout-rail">
            <legend class="claim-refund-legend" id="claim-rail-legend">Receive via</legend>
            <div class="claim-refund-rails">
              <label class="claim-refund-rail-card is-active">
                <input type="radio" name="claim_payout_rail" value="onchain" checked />
                <span class="claim-refund-rail-kicker">Bitcoin</span>
                <span class="claim-refund-rail-name">On-chain</span>
                <span class="claim-refund-rail-meta mono">${addressHrp()}…</span>
              </label>
            </div>
            <p class="claim-refund-dest-hint muted" id="claim-ln-rail-note">
              Bounty payouts must be an on-chain address so they can be baked into a presigned PSBT. Lightning Address and LNURL are for Direct campaigns only.
            </p>
          </fieldset>

          <div class="claim-refund-dest">
            <label class="donate-amount-label" for="claim-payout" id="claim-payout-label">On-chain address</label>
            <input
              id="claim-payout"
              class="donate-amount mono"
              type="text"
              inputmode="text"
              autocomplete="off"
              spellcheck="false"
              autocapitalize="off"
              placeholder="${addressHrp()}…"
              aria-describedby="claim-payout-desc"
            />
            <p class="claim-refund-dest-hint muted" id="claim-payout-desc">
              Wallet you control on ${networkLabel()}.
            </p>
          </div>

          <label class="claim-refund-ack" for="claim-payout-ack">
            <input type="checkbox" id="claim-payout-ack" />
            <span id="claim-payout-ack-label">I control this destination and can receive the refund or payout.</span>
          </label>
        </div>

        <div class="claim-modal-section" id="claim-bond-slot" hidden></div>

        <div class="claim-modal-section" id="claim-finalize" hidden>
          <label class="donate-amount-label" for="claim-note">Note (optional)</label>
          <input id="claim-note" class="donate-amount" type="text" maxlength="200" placeholder="Short note for reviewers" />
          ${tosCheckboxHtml("claim-tos-ack")}
        </div>
        <p class="builder-msg" id="claim-modal-msg" hidden></p>
        <div class="donate-actions claim-modal-actions">
          <button type="button" class="btn ghost" id="claim-back" hidden>Back</button>
          <button type="button" class="btn" id="claim-next">Continue</button>
          <button type="button" class="btn" id="claim-confirm" hidden>Submit application</button>
          <button type="button" class="btn ghost" id="claim-cancel">Cancel</button>
        </div>
      </div>
    </div>
  </div>`;
}

function fundsAccountHref(): string {
  return href("/account", "?tab=funds");
}

function fundsAccountLinkHtml(label = "Account → Funds"): string {
  return `<a href="${fundsAccountHref()}">${escapeHtml(label)}</a>`;
}

function setMsg(
  el: HTMLElement | null,
  text: string | null,
  cls = "",
  opts?: { html?: boolean },
): void {
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.className = "builder-msg";
    return;
  }
  el.hidden = false;
  const out =
    cls === "error"
      ? sanitizePublicError(text, "Something went wrong. Try again in a few minutes.")
      : text;
  if (opts?.html) el.innerHTML = out;
  else el.textContent = out;
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
    !(state === "claimed" || state === "in_review")
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
  proposal: Proposal,
  isProposer = false,
  apps?: ClaimApplicationsResponse | null,
  reviewerActive = false,
): void {
  const proposalPath = proposal.path;
  const isYou = sessionIsClaimStatusFulfiller(user, status);
  const action = resolveNextAction({
    proposal,
    claim: status,
    apps,
    user,
    reviewerActive,
    isProposer,
    isBuilder: isYou,
  });
  const track = claimerTrackHtml(status);
  const meta = metaBits(status);
  const wbSlot = `<div id="workboard-settings-host"></div>`;
  const collab = `<div id="claim-collab-host"></div>`;
  const award = `<p class="builder-status muted" id="claim-award-reason" hidden></p>`;
  const checkpointForm = `<div id="checkpoint-form" class="deliverable-form" hidden>
          <label class="donate-amount-label" for="checkpoint-url">Progress URL</label>
          <input id="checkpoint-url" class="donate-amount" type="url" placeholder="https://…" />
          <button type="button" class="btn" id="checkpoint-submit">Save checkpoint</button>
        </div>`;
  const delivForm = deliverableFormHtml().replace(
    'class="deliverable-form"',
    'class="deliverable-form" hidden',
  );
  const more = nextActionMoreHtml(action, {
    checkpoint: `<button type="button" class="btn ghost" id="builder-checkpoint">File checkpoint</button>${checkpointForm}`,
    extension:
      isYou && !status.claim_extension_used
        ? `<button type="button" class="btn ghost" id="builder-request-extension">Request 30-day extension</button>`
        : isYou
          ? `<p class="builder-status muted">30-day extension already used.</p>`
          : "",
    challenge: status.can_challenge_abandoned
      ? `<button type="button" class="btn ghost" id="builder-challenge" data-path="${escapeHtml(proposalPath)}">Challenge as abandoned</button>`
      : "",
    collab,
    workboard: wbSlot,
  });
  const head = nextActionCardHtml(action, {
    extra: `${action.button === "deliverable" || (status.state === "in_review" && isYou && !status.review_decision_open) ? delivForm : ""}${more}`,
  });

  switch (status.state) {
    case "open":
      body.innerHTML = `${head}${track}<div id="claim-apps-host"></div>`;
      break;
    case "below_floor":
      body.innerHTML = head;
      break;
    case "claim_pending": {
      const pr = safeHrefAttr(status.pending?.pr_url);
      body.innerHTML = `${head}${track}${meta}${
        pr ? `<p class="builder-status muted"><a href="${pr}" target="_blank" rel="noreferrer">PR</a></p>` : ""
      }`;
      break;
    }
    case "claimed":
      body.innerHTML = `${head}${track}${meta}${award}`;
      break;
    case "in_review":
      body.innerHTML = `${head}${track}${meta}${award}`;
      break;
    case "completed":
      body.innerHTML = `${head}${track}${meta}`;
      break;
    default:
      body.innerHTML = head || `<p class="builder-status muted">Not available for claim.</p>`;
  }
}

export async function bindBuilderPanel(
  root: ParentNode,
  opts: {
    proposal: Proposal;
    balance?: number;
    user: AuthUser | null;
    watching: boolean;
    initialStatus?: ClaimStatus | null;
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

  // Register Donate click context before any await so first-paint Donate works.
  let seededStatus = opts.initialStatus ?? null;
  let claimStatusPromise: Promise<Awaited<ReturnType<typeof fetchClaimStatus>>> | null =
    seededStatus
      ? Promise.resolve(seededStatus)
      : fetchClaimStatus(opts.proposal.path, opts.proposal.id);
  {
    const earlyOpts = {
      address: String(opts.proposal.escrow_address || ""),
      proposalId: opts.proposal.id,
      proposalPath: opts.proposal.path,
      proposalTitle: opts.proposal.title,
      signedIn: Boolean(opts.user),
      initialBalance: opts.balance ?? opts.proposal.balance_sats ?? 0,
      claimFloorSats: CLAIM_FLOOR_SATS,
      targetSats: opts.proposal.target_sats,
      creditPrefs: opts.user?.funder_credit
        ? {
            public_credit: opts.user.funder_credit.public_credit !== false,
            anonymous: opts.user.funder_credit.public_credit === false,
            show_amount: Boolean(opts.user.funder_credit.show_amount),
          }
        : null,
    };
    setDonateChromeContext({
      root,
      proposal: opts.proposal,
      panelOpts: earlyOpts,
      claimStatusPromise,
    });
    bindDonateModal(document);
  }

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
      setMsg(msg, "Submitting…");
      const delivBtn = panel.querySelector<HTMLButtonElement>("#deliv-submit");
      try {
        const result = delivBtn
          ? await runBusy(
              delivBtn,
              () =>
                submitDeliverable({
                  proposal_path: opts.proposal.path,
                  deliverable_url: url,
                  description,
                  artifact_hash: hash || undefined,
                }),
              { busyLabel: "Submitting…" },
            )
          : await submitDeliverable({
              proposal_path: opts.proposal.path,
              deliverable_url: url,
              description,
              artifact_hash: hash || undefined,
            });
        if (!result) return;
        const next =
          result.decision_id
            ? "Reviewer ballot opened."
            : "Submitted. The proposer can mark this done.";
        setMsg(msg, next, "success");
        const slot = panel.querySelector<HTMLElement>("#ai-review-slot");
        if (slot && result.ai_review) {
          const { aiReviewCardHtml } = await import("./review-panel");
          slot.hidden = false;
          slot.innerHTML = aiReviewCardHtml(result.ai_review);
        }
        if (refresh) await refresh();
      } catch (e) {
        if ((e as Error).message === "login_required") {
          requireLogin("Sign in to submit a deliverable.");
        } else setMsg(msg, (e as Error).message, "error");
      }
    });
  };

  const bindPayoutCard = async (asFulfiller = false) => {
    const slot = panel.querySelector<HTMLElement>("#payout-status-slot");
    if (!slot || !opts.proposal.id || !opts.user) return;
    const proposerMatch = userMatchesProposer(
      opts.user,
      opts.proposal.proposer,
      opts.proposal.proposer_type,
    );
    if (!proposerMatch && !asFulfiller) return;
    try {
      const payout = await fetchPayoutStatus(opts.proposal.id);
      if (!payout) {
        slot.hidden = true;
        slot.innerHTML = "";
        return;
      }
      slot.innerHTML = payoutStatusCardHtml(payout);
      slot.hidden = false;
    } catch (e) {
      if ((e as Error).message === "login_required") return;
      slot.hidden = true;
    }
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
    const isProposer = userMatchesProposer(
      opts.user,
      opts.proposal.proposer,
      opts.proposal.proposer_type,
    );
    if (slot) {
      if (!floorMet || !canSubmit || !opts.user || !isProposer) {
        slot.innerHTML = "";
      } else {
        const form = deliverableFormHtml().replace(
          'class="deliverable-form"',
          'class="deliverable-form" hidden',
        );
        slot.innerHTML = panel.querySelector("#builder-deliverable")
          ? form
          : `<button type="button" class="btn" id="builder-deliverable">Submit deliverable</button>${form}`;
        bindDeliverable();
      }
    }
    void bindPayoutCard();
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
  type ClaimWizardStep = "who" | "refund" | "bond" | "submit";
  let claimStep: ClaimWizardStep = "who";
  const stepWho = panel.querySelector<HTMLElement>("#claim-step-who");
  const stepRefund = panel.querySelector<HTMLElement>("#claim-step-refund");
  const stepLabel = panel.querySelector<HTMLElement>("#claim-modal-step");
  const claimNext = panel.querySelector<HTMLButtonElement>("#claim-next");
  const claimBack = panel.querySelector<HTMLButtonElement>("#claim-back");
  const payoutAck = panel.querySelector<HTMLInputElement>("#claim-payout-ack");

  const syncClaimFeeStep = (step: "pay" | "txid") => {
    if (claimStep !== "bond" && claimStep !== "submit") return;
    if (step === "txid") {
      claimStep = "submit";
      void showClaimStep("submit");
    }
  };

  const mountClaimFeePay = async () => {
    if (!bondSlot) return;
    feePay?.stop();
    feePay = null;
    const bondSats =
      typeof params.claim_bond_sats === "number" &&
      params.claim_bond_sats === CLAIM_BOND_SATS
        ? params.claim_bond_sats
        : CLAIM_BOND_SATS;
    bondSlot.innerHTML = `<p class="muted">Issuing your bond address…</p>`;
    try {
      const intent = await fetchPayIntent("claim_bond");
      const feeAddr = intent.address.trim();
      if (!feeAddr || !escrowAddressMatchesNetwork(feeAddr)) {
        bondSlot.innerHTML =
          `<p class="builder-status error">Bond fee address unavailable or wrong network — refresh and try again.</p>`;
        return;
      }
      bondSlot.innerHTML = feePayHtml({
        id: "claim-bond",
        amountSats: bondSats,
        address: feeAddr,
        kind: "bond",
        assigned: true,
        note:
          intent.mode === "unique"
            ? "Pay on-chain to this bond address (not your payout). Bond refunds to the destination from the previous step · forfeited on expiry or abandoned checkpoint"
            : "Pay on-chain to your assigned bond address (not your payout). Bond refunds to the destination from the previous step · forfeited on expiry or abandoned checkpoint",
      });
      feePay = await bindFeePay(panel, "claim-bond", {
        onStep: syncClaimFeeStep,
      });
      feePay?.setStep("pay");
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Could not issue a bond address";
      bondSlot.innerHTML = `<p class="builder-status error">${escapeHtml(text)}</p><button type="button" class="btn ghost" id="claim-bond-retry">Try again</button>`;
      bondSlot
        .querySelector("#claim-bond-retry")
        ?.addEventListener("click", () => {
          void mountClaimFeePay();
        });
    }
  };

  const selectedPayoutRail = (): PayoutRail => "onchain";

  const syncPayoutRailUi = () => {
    const rail = selectedPayoutRail();
    panel
      .querySelectorAll<HTMLLabelElement>(".claim-refund-rail-card")
      .forEach((card) => {
        const input = card.querySelector<HTMLInputElement>(
          'input[name="claim_payout_rail"]',
        );
        card.classList.toggle("is-active", Boolean(input?.checked));
      });
    if (payoutInput) {
      payoutInput.placeholder =
        rail === "lightning"
          ? "you@wallet.com or lnurl1…"
          : `${addressHrp()}…`;
      payoutInput.setAttribute(
        "aria-invalid",
        payoutInput.value.trim() &&
          !payoutLooksValid(payoutInput.value, rail)
          ? "true"
          : "false",
      );
    }
    const payoutLabel = panel.querySelector("#claim-payout-label");
    const destHint = panel.querySelector("#claim-payout-desc");
    if (payoutLabel) {
      payoutLabel.textContent =
        rail === "lightning" ? "Lightning Address or LNURL" : "On-chain address";
    }
    if (destHint) {
      destHint.textContent =
        rail === "lightning"
          ? "Use a Lightning Address or lnurl1… you control."
          : `Use a wallet you control on ${networkLabel()}.`;
    }
    const ackLabel = panel.querySelector("#claim-payout-ack-label");
    if (ackLabel) {
      ackLabel.textContent =
        rail === "lightning"
          ? "I control this Lightning destination and can receive the refund or payout."
          : `I control this on-chain address and can receive on ${networkLabel()}.`;
    }
  };

  const showClaimStep = async (step: ClaimWizardStep) => {
    claimStep = step;
    if (stepWho) stepWho.hidden = step !== "who";
    if (stepRefund) stepRefund.hidden = step !== "refund";
    if (bondSlot) bondSlot.hidden = step !== "bond" && step !== "submit";
    if (finalize) finalize.hidden = step !== "submit";
    if (claimConfirm) claimConfirm.hidden = step !== "submit";
    if (claimNext) {
      claimNext.hidden = step === "submit";
      claimNext.textContent =
        step === "bond" ? "I paid — enter txid" : "Continue";
    }
    if (claimBack) claimBack.hidden = step === "who";
    if (stepLabel) {
      const labels: Record<ClaimWizardStep, string> = {
        who: "Step 1 of 4 — Who",
        refund: "Step 2 of 4 — Refund readiness",
        bond: "Step 3 of 4 — Pay bond",
        submit: "Step 4 of 4 — Submit",
      };
      stepLabel.textContent = labels[step];
    }
    const awareness = panel.querySelector("#claim-modal-awareness");
    if (awareness && step === "refund") {
      awareness.textContent =
        "Set where your bond comes back — and where you get paid if you finish.";
    } else if (awareness && step === "who") {
      awareness.textContent =
        "Review current applicants before paying the bond.";
    } else if (awareness && step === "bond") {
      awareness.textContent =
        "Pay the claim bond on-chain. Refunds go to the destination from the previous step.";
    } else if (awareness && step === "submit") {
      awareness.textContent =
        "Confirm the bond txid and submit your application.";
    }
    const payoutHint = panel.querySelector("#claim-payout-hint");
    if (step === "refund" && payoutHint) {
      const orgApply =
        (
          panel.querySelector(
            'input[name="claimer_type"]:checked',
          ) as HTMLInputElement | null
        )?.value === "org";
      payoutHint.textContent = orgApply
        ? "Saved on this org application (not your personal Account payout)."
        : "Claim bond refund and, if you finish, the monthly escrow payout. Not the fee/bond pay address.";
      syncPayoutRailUi();
    }
    if (step === "bond" || step === "submit") {
      if (!bondSlot?.querySelector("#claim-bond")) {
        await mountClaimFeePay();
      }
    }
  };

  if (
    payoutInput &&
    opts.user?.payout_address &&
    !isLightningPayoutDestination(opts.user.payout_address)
  ) {
    payoutInput.value = opts.user.payout_address;
  }
  await showClaimStep("who");

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
        const app = apps.applications.find((a) => a.id === id);
        const login = app?.claimer_login || "this applicant";
        const ok = await confirmAction({
          title: "Award claim?",
          body: `Award @${login}? Their bond stays locked until completion; other bonded applicants become refundable. This cannot be undone from the UI.`,
          confirmLabel: "Award",
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          await acceptClaimApplication({
            proposal_path: opts.proposal.path,
            application_id: id,
          });
          setMsg(msg, "Awarded.", "success");
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
        const app = apps.applications.find((a) => a.id === id);
        const login = app?.claimer_login || "this applicant";
        const ok = await confirmAction({
          title: "Reject applicant?",
          body: `Reject @${login}? Their bond becomes refundable. This cannot be undone from the UI.`,
          confirmLabel: "Reject",
          danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          await rejectClaimApplication({
            proposal_path: opts.proposal.path,
            application_id: id,
          });
          setMsg(
            msg,
            `Applicant rejected; bond refundable under ${fundsAccountLinkHtml()}.`,
            "success",
            { html: true },
          );
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
        const ok = await confirmAction({
          title: "Withdraw application?",
          body: "Your bond becomes refundable to the address you set at apply.",
          confirmLabel: "Withdraw",
          danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          await withdrawClaimApplication({
            proposal_path: opts.proposal.path,
            application_id: id,
          });
          const proposalId = opts.proposal.id?.trim() || "";
          let needsAddr = false;
          try {
            const bondsRes = await authFetch(`${WORKERS_API}/claims/bonds/mine`);
            if (bondsRes.ok) {
              const data = (await bondsRes.json()) as {
                bonds?: { proposal_id: string; needs_refund_address?: boolean }[];
              };
              needsAddr = Boolean(
                proposalId &&
                  data.bonds?.find((b) => b.proposal_id === proposalId)
                    ?.needs_refund_address,
              );
            }
          } catch {
            /* ignore */
          }
          if (needsAddr && proposalId) {
            const addr = await promptText({
              title: "Bond refund destination",
              body: "Needed before your bond can be returned. Cancel leaves it under Account → Funds.",
              defaultValue: opts.user?.payout_address || "",
              placeholder: lightningUiAllowed()
                ? "bc1… / tb1… or you@host"
                : `${addressHrp()}…`,
              confirmLabel: "Save",
              validate: (v) =>
                payoutLooksValid(v)
                  ? null
                  : lightningUiAllowed()
                    ? "Enter a network bech32 address or Lightning Address."
                    : `Enter a valid ${addressHrp()}… address.`,
            });
            if (addr) {
              const put = await authFetch(
                `${WORKERS_API}/claims/bonds/${encodeURIComponent(proposalId)}/refund-address`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ refund_address: addr }),
                },
              );
              const putBody = (await put.json().catch(() => ({}))) as {
                error?: string;
                package_error?: boolean;
                note?: string;
              };
              if (!put.ok && !putBody.package_error) {
                setMsg(
                  msg,
                  putBody.error ||
                    `Withdrawn, but refund address failed — set it under ${fundsAccountLinkHtml()}.`,
                  "error",
                  { html: true },
                );
                await refreshStatus();
                return;
              }
              if (putBody.package_error) {
                setMsg(
                  msg,
                  putBody.note ||
                    `Withdrawn and address saved, but payout setup failed — retry under ${fundsAccountLinkHtml()}.`,
                  "error",
                  { html: true },
                );
                await refreshStatus();
                return;
              }
            } else {
              setMsg(
                msg,
                `Withdrawn — set your refund address under ${fundsAccountLinkHtml()} before it can be returned.`,
                "success",
                { html: true },
              );
              await refreshStatus();
              return;
            }
          }
          setMsg(
            msg,
            `Application withdrawn; bond refundable — track it under ${fundsAccountLinkHtml()}.`,
            "success",
            { html: true },
          );
          await refreshStatus();
        } catch (e) {
          if ((e as Error).message === "login_required") {
            requireLogin("Sign in to withdraw your application.");
          } else setMsg(msg, (e as Error).message, "error");
          btn.disabled = false;
        }
      });
    });
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
    const seeded = seededStatus;
    seededStatus = null;
    const firstClaim = claimStatusPromise;
    claimStatusPromise = null;
    const [status, apps, reviewerMe] = await Promise.all([
      seeded
        ? Promise.resolve(seeded)
        : firstClaim
          ? firstClaim
          : fetchClaimStatus(opts.proposal.path, opts.proposal.id),
      fetchClaimApplications(opts.proposal.path, opts.proposal.id).catch(
        () => null,
      ),
      opts.user ? fetchReviewerMe().catch(() => null) : Promise.resolve(null),
    ]);
    const reviewerActive = Boolean(reviewerMe?.active);
    if (!status && body) {
      syncHeroClaimChip(apps);
      body.innerHTML = `<p class="builder-status muted">Couldn’t load claim status.</p>
        <button type="button" class="btn ghost" id="builder-status-retry">Retry</button>`;
      body
        .querySelector("#builder-status-retry")
        ?.addEventListener("click", () => {
          void refreshStatus();
        });
      return;
    }
    if (status && body) {
      if (!status.claimer_type && opts.proposal.claimer_type) {
        status.claimer_type = opts.proposal.claimer_type;
      }
      if (!status.claim_agent && opts.proposal.claim_agent) {
        status.claim_agent = opts.proposal.claim_agent;
      }
      const mergedProposal = applyClaimStatusToProposal(opts.proposal, status);
      Object.assign(opts.proposal, mergedProposal);
      const donatePanelOpts = {
        address: String(opts.proposal.escrow_address || ""),
        proposalId: opts.proposal.id,
        proposalPath: opts.proposal.path,
        proposalTitle: opts.proposal.title,
        signedIn: Boolean(opts.user),
        initialBalance: opts.balance ?? opts.proposal.balance_sats ?? 0,
        claimFloorSats: CLAIM_FLOOR_SATS,
        targetSats: opts.proposal.target_sats,
        creditPrefs: opts.user?.funder_credit
          ? {
              public_credit: opts.user.funder_credit.public_credit !== false,
              anonymous: opts.user.funder_credit.public_credit === false,
              show_amount: Boolean(opts.user.funder_credit.show_amount),
            }
          : null,
      };
      setDonateChromeContext({
        root,
        proposal: opts.proposal,
        panelOpts: donatePanelOpts,
      });
      // Markdown may omit escrow; claim JSON often has it. Mount Donate modal now
      // so #donate-open / [data-open-donate] from next-action actually open it.
      await mountDonateChromeWhenEscrowKnown(root, opts.proposal, donatePanelOpts);
      // Prefer document scope: root may be stale after a concurrent SPA re-render,
      // while the visible stepper always lives under .proposal-page.
      const refreshStepper = () => {
        const stepper =
          document.querySelector(".proposal-page .proposal-stepper") ||
          root.querySelector(".proposal-stepper");
        if (stepper) {
          stepper.outerHTML = proposalStepperHtml(mergedProposal);
        }
        const pillHost = document.querySelector(".proposal-hero-top");
        if (pillHost) {
          const prev = pillHost.querySelector(".pill-status");
          const next = statusPillHtml(String(mergedProposal.status || ""));
          if (prev && next) prev.outerHTML = next;
          else if (prev && !next) prev.remove();
          else if (!prev && next) pillHost.insertAdjacentHTML("beforeend", next);
        }
      };
      refreshStepper();
      syncHeroClaimChip(apps);
      const isProposer = userMatchesProposer(
        opts.user,
        opts.proposal.proposer,
        opts.proposal.proposer_type,
      );
      const asFulfiller = sessionIsClaimStatusFulfiller(opts.user, status);
      void bindPayoutCard(asFulfiller);
      renderStatusBody(
        body,
        status,
        opts.user,
        opts.proposal,
        isProposer,
        apps,
        reviewerActive,
      );
      const next = resolveNextAction({
        proposal: opts.proposal,
        claim: status,
        apps,
        user: opts.user,
        reviewerActive,
        isProposer,
        isBuilder: asFulfiller,
      });
      const donateSlot = root.querySelector<HTMLElement>(".proposal-donate-slot");
      if (donateSlot) {
        const structured = String(claimStructuredState(status) || "");
        const sideDonateOk =
          next.button !== "donate" &&
          (isFundableStatus(String(opts.proposal.status || "")) ||
            structured === "awaiting_funds");
        if (next.button === "donate") {
          donateSlot.hidden = true;
          donateSlot.innerHTML = "";
        } else if (sideDonateOk) {
          donateSlot.hidden = false;
          if (!donateSlot.querySelector("[data-open-donate]")) {
            donateSlot.innerHTML = donateTriggerHtml();
          }
        } else {
          donateSlot.hidden = true;
          donateSlot.innerHTML = "";
        }
      }
      body.querySelector("#next-rebuttal")?.addEventListener("click", () => {
        document.querySelector<HTMLElement>("#rebuttal-text")?.focus();
      });
      body.querySelector("#next-register")?.addEventListener("click", () => {
        document.querySelector<HTMLElement>("#refund-address")?.focus();
      });
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
        const reasonEl = body.querySelector<HTMLElement>("#claim-award-reason");
        if (reasonEl) {
          const label =
            apps.award_reason === "proposer_accept"
              ? "Selected by proposer"
              : apps.award_reason === "auto_earliest_bonded"
                ? "Auto-awarded (earliest bond)"
                : apps.award_reason === "first_bonded"
                  ? "First bonded"
                  : apps.award_reason;
          reasonEl.hidden = false;
          reasonEl.textContent = label;
        }
      }
      if (apps && (status.state === "claimed" || status.state === "in_review")) {
        const isYou = sessionIsClaimStatusFulfiller(opts.user, status);
        await bindCollaboratorUi(apps, isYou);
      }
      const awareness = panel.querySelector("#claim-modal-awareness");
      // Don't clobber step-specific copy after the wizard has advanced.
      if (awareness && apps && claimStep === "who") {
        const phaseBit =
          apps.phase === "grace" && apps.decision_ends_at
            ? ` · auto-award ${relativeTimeLeft(apps.decision_ends_at)}`
            : apps.window_ends_at && apps.summary.bonded > 0
              ? ` · ${relativeTimeLeft(apps.window_ends_at)} in window`
              : "";
        awareness.textContent = `Mode: ${
          apps.claim_mode === "first_bonded" ? "first bonded wins" : "proposer picks"
        } · ${apps.summary.bonded} bonded${phaseBit}. Continue?`;
      }
      // Re-apply after awaits — a concurrent navigate can replace #app mid-flight;
      // document-scoped refresh still hits the visible stepper.
      refreshStepper();
      bindClaimButton();
      bindDeliverable(refreshStatus);
      bindCheckpoint();
      bindChallenge();
      bindDone(refreshStatus);
      bindFlag(refreshStatus);
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
    feePay?.stop();
    if (bondSlot) bondSlot.innerHTML = "";
    void showClaimStep("who");
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
    if (payoutAck) payoutAck.checked = false;
    void showClaimStep("who");
  };

  const bindClaimButton = () => {
    panel.querySelector<HTMLButtonElement>("#builder-claim")?.addEventListener(
      "click",
      () => {
        if (!opts.user) {
          requireLogin("Sign in to apply for this project.");
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

  claimNext?.addEventListener("click", async () => {
    setMsg(modalMsg(), null);
    if (claimStep === "who") {
      const claimerType =
        (
          panel.querySelector(
            'input[name="claimer_type"]:checked',
          ) as HTMLInputElement | null
        )?.value === "org"
          ? "org"
          : "individual";
      const orgLogin =
        panel.querySelector<HTMLSelectElement>("#claim-org-login")?.value.trim() ||
        "";
      if (claimerType === "org" && !orgLogin) {
        setMsg(
          modalMsg(),
          "Select a linked GitHub org (or link one on Account).",
          "error",
        );
        return;
      }
      await showClaimStep("refund");
      payoutInput?.focus();
      return;
    }
    if (claimStep === "refund") {
      const payout = payoutInput?.value.trim() || "";
      const rail = selectedPayoutRail();
      if (isLightningPayoutDestination(payout)) {
        payoutInput?.setAttribute("aria-invalid", "true");
        setMsg(modalMsg(), BOUNTY_ONCHAIN_PAYOUT_ERROR, "error");
        payoutInput?.focus();
        return;
      }
      if (!payoutLooksValid(payout, rail)) {
        payoutInput?.setAttribute("aria-invalid", "true");
        setMsg(
          modalMsg(),
          `Enter a valid ${addressHrp()}… address for this network.`,
          "error",
        );
        payoutInput?.focus();
        return;
      }
      payoutInput?.setAttribute("aria-invalid", "false");
      if (!payoutAck?.checked) {
        setMsg(
          modalMsg(),
          "Confirm you control this destination before paying the bond.",
          "error",
        );
        panel.querySelector<HTMLInputElement>("#claim-payout-ack")?.focus();
        return;
      }
      // Individual only — org awards keep payout on the application / org ledger.
      const orgApply =
        (
          panel.querySelector(
            'input[name="claimer_type"]:checked',
          ) as HTMLInputElement | null
        )?.value === "org";
      if (!orgApply) {
        try {
          await updateProfile({ payout_address: payout });
          if (opts.user) opts.user.payout_address = payout;
        } catch (e) {
          setMsg(modalMsg(), (e as Error).message, "error");
          return;
        }
      }
      await showClaimStep("bond");
      return;
    }
    if (claimStep === "bond") {
      feePay?.setStep("txid");
      await showClaimStep("submit");
      return;
    }
  });

  claimBack?.addEventListener("click", async () => {
    setMsg(modalMsg(), null);
    if (claimStep === "refund") await showClaimStep("who");
    else if (claimStep === "bond") {
      // Returning to refund readiness — require a fresh address ack.
      if (payoutAck) payoutAck.checked = false;
      await showClaimStep("refund");
    } else if (claimStep === "submit") {
      claimStep = "bond";
      await showClaimStep("bond");
      feePay?.setStep("txid");
    }
  });

  payoutInput?.addEventListener("input", () => {
    if (payoutAck) payoutAck.checked = false;
  });

  panel.querySelectorAll<HTMLInputElement>('input[name="claim_payout_rail"]').forEach(
    (radio) => {
      radio.addEventListener("change", () => {
        if (payoutAck) payoutAck.checked = false;
        syncPayoutRailUi();
        void showClaimStep("refund");
      });
    },
  );

  panel.querySelector("#claim-confirm")?.addEventListener("click", async () => {
    if (!opts.user) {
      requireLogin("Sign in to apply for this project.");
      return;
    }
    const payout = payoutInput?.value.trim() || "";
    const bond = feePay?.getTxid() || "";
    if (
      isLightningPayoutDestination(payout) ||
      !payoutLooksValid(payout, selectedPayoutRail()) ||
      !payoutAck?.checked
    ) {
      await showClaimStep("refund");
      setMsg(
        modalMsg(),
        isLightningPayoutDestination(payout)
          ? BOUNTY_ONCHAIN_PAYOUT_ERROR
          : "Complete refund readiness before submitting.",
        "error",
      );
      return;
    }
    if (!bond || bond.length !== 64) {
      await showClaimStep("bond");
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
    const tosAck = panel.querySelector<HTMLInputElement>("#claim-tos-ack")?.checked;
    if (!tosAck) {
      setMsg(modalMsg(), "Accept the Terms to apply.", "error");
      return;
    }
    setMsg(modalMsg(), "Submitting bonded application…");
    const confirmBtn = panel.querySelector<HTMLButtonElement>("#claim-confirm");
    try {
      const result = confirmBtn
        ? await runBusy(
            confirmBtn,
            () =>
              submitClaim({
                proposal_path: opts.proposal.path,
                payout_address: payout,
                note: noteInput?.value.trim() || undefined,
                claim_bond_txid: bond,
                claimer_type: claimerType,
                org_login: claimerType === "org" ? orgLogin : undefined,
                tos_ack: true,
              }),
            {
              busyLabel: "Submitting…",
              stayBusyOnSuccess: true,
            },
          )
        : await submitClaim({
            proposal_path: opts.proposal.path,
            payout_address: payout,
            note: noteInput?.value.trim() || undefined,
            claim_bond_txid: bond,
            claimer_type: claimerType,
            org_login: claimerType === "org" ? orgLogin : undefined,
            tos_ack: true,
          });
      if (!result) return;
      closeClaimModal();
      setMsg(
        msg,
        result.unwound
          ? `Award race lost — your bond is refundable under ${fundsAccountLinkHtml()}.`
          : result.awarded
            ? "Awarded. Work window started."
            : "Application bonded. Awaiting proposer / auto-award.",
        "success",
        result.unwound ? { html: true } : undefined,
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
                    ? avatarImgHtml(o.avatar_url, "avatar", 22)
                    : orgAvatarSlotHtml(o.login)
                }${escapeHtml(o.login)}</a>`,
            )
            .join("")
        : "";
      void hydrateAvatarSlots(orgPreview);
    }
    if (hint) {
      hint.innerHTML = linked.length
        ? `Using orgs linked on <a href="${href("/account", "", "#account-orgs")}">Account</a>.`
        : opts.user?.id.startsWith("github:")
          ? `No linked orgs. <a href="${href("/account", "", "#account-orgs")}">Link GitHub orgs</a> on Account first.`
          : `Org apply requires a GitHub session. <a href="${href("/account", "", "#account-orgs")}">Account</a>`;
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

  const bindDone = (refresh?: () => Promise<void>) => {
    panel.querySelector("#builder-done")?.addEventListener("click", async () => {
      if (!opts.user) {
        requireLogin("Sign in as the proposer to mark this done.");
        return;
      }
      const allocationId =
        panel.querySelector<HTMLSelectElement>("#builder-allocation")?.value.trim() ||
        undefined;
      const ok = await confirmAction({
        title: "Mark this done?",
        body: "Confirmed donors get a size-scaled window to flag (7, 14, or 30 days). If nobody flags, the clean branch is selected for keyholder review.",
        confirmLabel: "This is done",
      });
      if (!ok) return;
      setMsg(msg, "Opening the donor window…");
      try {
        const done = await markProposalDone({
          proposal_path: opts.proposal.path,
          proposal_id: opts.proposal.id || undefined,
          allocation_id: allocationId,
        });
        const days = done.window_days || 7;
        setMsg(msg, `Donors have ${days} days to flag.`, "success");
        if (refresh) await refresh();
      } catch (e) {
        const err = (e as Error).message;
        if (err === "login_required") {
          requireLogin("Sign in as the proposer to mark this done.");
        } else setMsg(msg, err, "error");
      }
    });
  };

  const bindFlag = (refresh?: () => Promise<void>) => {
    panel.querySelector("#builder-flag")?.addEventListener("click", async () => {
      if (!opts.user) {
        requireLogin("Sign in as a confirmed donor to flag this close.");
        return;
      }
      const reason = await promptText({
        title: "Flag this close?",
        body: "Explain why the work is not finished. Confirmed donors only. This opens a reviewer check.",
        placeholder: "What is missing or wrong…",
        confirmLabel: "Flag",
        validate: (v) =>
          v.trim().length < 40
            ? "Add more detail (at least 40 characters)."
            : null,
      });
      if (reason == null) return;
      const ok = await confirmAction({
        title: "Submit flag?",
        body: "This opens a reviewer check. Only confirmed donors on this project can do this.",
        confirmLabel: "Flag this close",
        danger: true,
      });
      if (!ok) return;
      setMsg(msg, "Opening reviewer check…");
      try {
        await flagProposalClose({
          proposal_path: opts.proposal.path,
          proposal_id: opts.proposal.id || undefined,
          reason: reason.trim(),
        });
        setMsg(msg, "Flagged. Reviewers will check the work.", "success");
        if (refresh) await refresh();
      } catch (e) {
        const err = (e as Error).message;
        if (err === "login_required") {
          requireLogin("Sign in as a confirmed donor to flag this close.");
        } else if (/donor|contributor|funder|confirmed/i.test(err)) {
          setMsg(
            msg,
            "Only confirmed donors of this project can flag this close.",
            "error",
          );
        } else setMsg(msg, err, "error");
      }
    });
  };

  const bindChallenge = () => {
    panel.querySelector("#builder-challenge")?.addEventListener("click", async () => {
      if (!opts.user) {
        requireLogin("Sign in to challenge this claim.");
        return;
      }
      const reason = await promptText({
        title: "Challenge as abandoned?",
        body: "Explain why this claim looks abandoned. Confirmed funders only — your note is included in the challenge PR.",
        defaultValue: "No progress / missed checkpoint",
        placeholder: "Short rationale…",
        confirmLabel: "Open challenge",
        validate: (v) =>
          v.trim().length < 12
            ? "Add a bit more detail (at least 12 characters)."
            : null,
      });
      if (reason == null) return;
      const ok = await confirmAction({
        title: "Submit abandoned-claim challenge?",
        body: "This opens a public challenge for reviewers. Only confirmed funders can do this.",
        confirmLabel: "Challenge",
        danger: true,
      });
      if (!ok) return;
      setMsg(msg, "Opening abandoned-claim challenge…");
      try {
        await submitAbandonedChallenge({
          proposal_path: opts.proposal.path,
          reason: reason.trim() || undefined,
        });
        setMsg(msg, "Challenge recorded.", "success");
      } catch (e) {
        const err = (e as Error).message;
        if (err === "login_required") requireLogin("Sign in to challenge this claim.");
        else if (/contributor|funder|confirmed/i.test(err)) {
          setMsg(
            msg,
            "Only confirmed funders of this project can open an abandoned-claim challenge.",
            "error",
          );
        } else setMsg(msg, err, "error");
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
        const ok = await confirmAction({
          title: "Request 30-day extension?",
          body: "Opens a reviewer ballot for one +30-day claim-window extension. You can only use this once per claim.",
          confirmLabel: "Request extension",
        });
        if (!ok) return;
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
