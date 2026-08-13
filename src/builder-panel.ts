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
import {
  CLAIM_BOND_SATS,
  CLAIM_FLOOR_SATS,
  WORKERS_API,
  addressHrp,
  escrowAddressMatchesNetwork,
  lightningUiAllowed,
  mempoolWeb,
  networkLabel,
} from "./config";
import { authFetch, loginChoicesHtml, updateProfile } from "./auth";
import type { AuthUser } from "./auth";
import { confirmAction, promptText } from "./confirm-modal";
import { bindFeePay, feePayHtml, type FeePayBinding } from "./fee-pay";
import { btnWithIcon, solidIcon } from "./icons";
import { safeHrefAttr } from "./social-links";
import {
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
import { href, orgHref, profileHref } from "./router";
import { userMatchesProposer } from "./proposal-ui";
import type { Proposal } from "./types";
import { sanitizePublicError } from "./public-errors";
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
    const agent = (claimAgent || "").replace(/^@/, "").trim().toLowerCase();
    if (!agent) return false;
    const gh = (user.github || "").replace(/^@/, "").trim().toLowerCase();
    const un = (user.username || "").replace(/^@/, "").trim().toLowerCase();
    return agent === gh || agent === un;
  }
  return false;
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
              <label class="claim-refund-rail-card${!lightningUiAllowed() ? " is-disabled" : ""}" title="${
                lightningUiAllowed()
                  ? "Lightning Address or LNURL"
                  : "Lightning refunds unavailable on signet — use mainnet"
              }">
                <input type="radio" name="claim_payout_rail" value="lightning"${
                  lightningUiAllowed() ? "" : " disabled"
                } aria-describedby="claim-ln-rail-note" />
                <span class="claim-refund-rail-kicker">Lightning</span>
                <span class="claim-refund-rail-name">Lightning</span>
                <span class="claim-refund-rail-meta" id="claim-ln-rail-note">${
                  lightningUiAllowed()
                    ? "you@host · lnurl"
                    : "Unavailable on signet"
                }</span>
              </label>
            </div>
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
  proposalPath: string,
  isProposer = false,
): void {
  const days = claimWindowDaysLeft(
    status.claimed_at,
    status.claim_window_ends_at,
  );
  const isYou = sessionIsClaimer(
    user,
    status.claimer,
    status.claimer_type,
    status.claim_agent,
  );
  const showWb =
    isProposer &&
    (status.state === "claimed" || status.state === "in_review");
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
  const extensionTools =
    isYou && !status.claim_extension_used
      ? `<div class="builder-extension">
        <button type="button" class="btn ghost" id="builder-request-extension">Request 30-day extension</button>
      </div>`
      : isYou && status.claim_extension_used
        ? `<p class="builder-status muted">30-day extension already used.</p>`
        : "";
  const deliverableResubmit =
    isYou && !status.review_decision_open
      ? `<div class="builder-claim-tools">
          <button type="button" class="btn" id="builder-deliverable">Resubmit deliverable</button>
        </div>
        ${deliverableFormHtml().replace(
          'class="deliverable-form"',
          'class="deliverable-form" hidden',
        )}`
      : isYou && status.review_decision_open
        ? `<p class="builder-status muted">Reviewer decision open — wait for tally before resubmitting.</p>`
        : "";

  switch (status.state) {
    case "open":
      // Primary CTA first (watch sits above); applicants list then leads into Donate.
      body.innerHTML = `${track}${claimBtnHtml()}<div id="claim-apps-host"></div>`;
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
      body.innerHTML = `${track}${meta}<p class="builder-status">Claim pending${(() => {
        const href = safeHrefAttr(status.pending?.pr_url);
        return href
          ? ` · <a href="${href}" target="_blank" rel="noreferrer">PR</a>`
          : "";
      })()}. Exclusive after merge.</p>`;
      break;
    case "claimed":
      if (isYou) {
        body.innerHTML = `${track}${meta}<p class="builder-status">You claimed this project${windowLabel}.</p>
        <p class="builder-status muted" id="claim-award-reason" hidden></p>
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
        const challengeBit = status.can_challenge_abandoned
          ? `<p class="builder-status muted">You funded this project — you can challenge if the claim looks abandoned.</p>
        <button type="button" class="btn ghost" id="builder-challenge" data-path="${escapeHtml(proposalPath)}">Challenge as abandoned</button>`
          : user
            ? `<p class="builder-status muted">Confirmed funders can challenge an abandoned claim.</p>`
            : `<p class="builder-status muted">Confirmed funders can challenge an abandoned claim after signing in.</p>`;
        body.innerHTML = `${track}${meta}<p class="builder-status">Claimed by ${claimerLabel}${windowLabel}.</p>
        <p class="builder-status muted" id="claim-award-reason" hidden></p>
        ${wbSlot}
        <div id="claim-collab-host"></div>
        ${challengeBit}`;
      }
      break;
    case "in_review":
      body.innerHTML = `${track}${meta}<p class="builder-status">In review${
        status.claimer ? ` · fulfiller ${claimerLabel}` : ""
      }${windowLabel}.</p>
      <p class="builder-status muted">Next: reviewers confirm the deliverable in the <a href="#review-panel">review panel</a>.</p>
      ${wbSlot}
      ${isYou ? `${deliverableResubmit}${extensionTools}` : ""}`;
      break;
    case "completed":
      body.innerHTML = `${track}${meta}<p class="builder-status">Completed${
        status.claimer ? ` · ${claimerLabel}` : ""
      }. ${
        status.claimer_type === "org" && status.claim_agent
          ? `Agent @${escapeHtml(status.claim_agent)} earns a reviewer seat.`
          : "Fulfiller earns a reviewer seat."
      } Paid in that UTC month’s release.</p>
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
      setMsg(msg, "Opening PR…");
      try {
        const result = await submitDeliverable({
          proposal_path: opts.proposal.path,
          deliverable_url: url,
          description,
          artifact_hash: hash || undefined,
        });
        const next =
          result.ai_review?.outcome === "fail"
            ? "Revise and resubmit."
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
    const isProposer = userMatchesProposer(
      opts.user,
      opts.proposal.proposer,
      opts.proposal.proposer_type,
    );
    if (slot) {
      if (!floorMet) {
        slot.innerHTML = "";
      } else if (!canSubmit) {
        slot.innerHTML = `<p class="builder-status muted">Deliverable not available in status ${escapeHtml(status)}.</p>`;
      } else if (!opts.user) {
        slot.innerHTML = `<p class="builder-status muted">Sign in as the proposer to submit a deliverable.</p>`;
      } else if (!isProposer) {
        const orgLogin =
          String(opts.proposal.proposer_type || "").toLowerCase() === "org"
            ? opts.proposal.proposer?.github?.trim()
            : "";
        slot.innerHTML = orgLogin
          ? `<p class="builder-status muted">Sign in as a linked admin of <a href="${orgHref(orgLogin)}">@${escapeHtml(orgLogin)}</a> to submit the deliverable.</p>`
          : `<p class="builder-status muted">Only the proposer can submit the deliverable on a direct proposal.</p>`;
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
    const feeAddr = params.fee_address?.trim() || "";
    const bondSats =
      typeof params.claim_bond_sats === "number" &&
      params.claim_bond_sats === CLAIM_BOND_SATS
        ? params.claim_bond_sats
        : CLAIM_BOND_SATS;
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
      note: "Pay on-chain to the published bond address (not your payout). Bond refunds to the destination from the previous step · forfeited on expiry or abandoned checkpoint",
    });
    feePay = await bindFeePay(panel, "claim-bond", {
      onStep: syncClaimFeeStep,
    });
    feePay?.setStep("pay");
  };

  const selectedPayoutRail = (): PayoutRail => {
    const v = (
      panel.querySelector(
        'input[name="claim_payout_rail"]:checked',
      ) as HTMLInputElement | null
    )?.value;
    return v === "lightning" && lightningUiAllowed() ? "lightning" : "onchain";
  };

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
          ? "Keyholders pay this via a Boltz submarine lockup. Use a Lightning Address or lnurl1… you control."
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
        "Set where keyholders return your bond — and where escrow goes if you complete.";
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

  if (payoutInput && opts.user?.payout_address) {
    payoutInput.value = opts.user.payout_address;
    if (
      lightningUiAllowed() &&
      isLightningPayoutDestination(opts.user.payout_address)
    ) {
      const ln = panel.querySelector<HTMLInputElement>(
        'input[name="claim_payout_rail"][value="lightning"]',
      );
      if (ln) ln.checked = true;
    }
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
          body: `Award @${login}? Their bond stays locked until completion; other bonded applicants become refundable. This opens the claim PR and cannot be undone from the UI.`,
          confirmLabel: "Award",
        });
        if (!ok) return;
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
          body: "Your bond becomes refundable to the payout destination you set at apply. Keyholders batch returns (on-chain or Lightning via Boltz lockup).",
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
              body: "Required before keyholders can return your bond (on-chain bc1…/tb1… or Lightning Address). Cancel leaves it under Account → Funds.",
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
                    `Withdrawn and address saved, but the keyholder package failed — retry under ${fundsAccountLinkHtml()}.`,
                  "error",
                  { html: true },
                );
                await refreshStatus();
                return;
              }
            } else {
              setMsg(
                msg,
                `Withdrawn — set your refund address under ${fundsAccountLinkHtml()} before keyholders can pay.`,
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
    const [status, apps] = await Promise.all([
      fetchClaimStatus(opts.proposal.path),
      fetchClaimApplications(opts.proposal.path),
    ]);
    syncHeroClaimChip(apps);
    if (!status && body) {
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
      const isProposer = userMatchesProposer(
        opts.user,
        opts.proposal.proposer,
        opts.proposal.proposer_type,
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
        const isYou = sessionIsClaimer(
          opts.user,
          status.claimer,
          status.claimer_type,
          status.claim_agent,
        );
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
      if (!payoutLooksValid(payout, rail)) {
        payoutInput?.setAttribute("aria-invalid", "true");
        setMsg(
          modalMsg(),
          rail === "lightning"
            ? "Enter a Lightning Address (you@host) or lnurl1…"
            : `Enter a valid ${addressHrp()}… address for this network.`,
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
    // Auto-select Lightning rail when the value looks like an LN destination.
    if (lightningUiAllowed() && isLightningPayoutDestination(payoutInput.value)) {
      const ln = panel.querySelector<HTMLInputElement>(
        'input[name="claim_payout_rail"][value="lightning"]',
      );
      if (ln && !ln.checked) {
        ln.checked = true;
        syncPayoutRailUi();
      }
    }
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
    if (!payoutLooksValid(payout, selectedPayoutRail()) || !payoutAck?.checked) {
      await showClaimStep("refund");
      setMsg(modalMsg(), "Complete refund readiness before submitting.", "error");
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
        result.unwound
          ? `Award race lost — your bond is refundable under ${fundsAccountLinkHtml()}.`
          : result.awarded && result.pr_url
            ? `Awarded. Claim PR: ${result.pr_url}`
            : `Application bonded. ${
                result.pr_url
                  ? `PR: ${result.pr_url}`
                  : "Awaiting proposer / auto-award."
              }`,
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
                    ? `<img class="avatar" src="${escapeHtml(o.avatar_url)}" alt="" width="22" height="22" />`
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
