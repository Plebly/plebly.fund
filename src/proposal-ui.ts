import QRCode from "qrcode";
import {
  authFetch,
  bindLoginHandlers,
  currentReturnPath,
  loginChoicesHtml,
} from "./auth";
import { claimModeHeroChipHtml } from "./claim-mode-ui";
import { isDirectProposal, isOpenToClaim, isTakenStatus } from "./builder";
import {
  applyCreditPreferencesToFields,
  bindCreditPreferenceGates,
  claimContributionWithRetry,
  creditPreferenceFieldsHtml,
  hasStoredCreditPreferences,
  loadStoredCreditPreferences,
  readCreditPreferences,
  recordContribution,
  saveStoredCreditPreferences,
  syncStoredCreditPreferencesFromProfile,
  watchNewUtxos,
  type CreditPreferences,
} from "./funder-credit";
import { btnWithIcon, solidIcon } from "./icons";
import { BITCOIN_NETWORK, WORKERS_API, lightningUiAllowed } from "./config";
import { signetPayNoteHtml } from "./signet";
import { openShareMenu, prefersNativeShare } from "./share-menu";
import {
  createEndowmentLightningInvoice,
  createLightningInvoice,
  fetchLightningStatus,
  fetchLightningSwap,
  lightningAmountError,
  lightningFeeHint,
  lightningLimits,
  lightningStatusSentence,
  weblnPay,
  type LightningStatus,
  type LightningSwapView,
} from "./lightning";
import { watchConfirmedBalance } from "./mempool";
import { depKindLabel, pleblyDepHref } from "./propose-deps";
import { href, proposalHref, SITE_ORIGIN } from "./router";
import type { Proposal, ProposalMilestone } from "./types";
import { bindHashGate, hashGateHtml } from "./psbt-hash-gate";
import { isFreshLinkedOrgAdmin } from "./github-orgs-client";
import { avatarSlotHtml, orgAvatarSlotHtml } from "./profile-avatars";
import { EDITABLE_PROPOSAL_STATUSES } from "./types";
import type { GithubOrgAttestation } from "./types";
import {
  bitcoinUri,
  escapeHtml,
  formatSats,
  formatTimeAhead,
  linkifyText,
  themeQrColors,
  timeAgoHtml,
} from "./util";

export { bitcoinUri };

const MEMPOOL_WEB =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet"
    : BITCOIN_NETWORK === "testnet"
      ? "https://mempool.space/testnet"
    : "https://mempool.space";

const DONATE_PRESETS_SATS = [10_000, 50_000, 100_000, 500_000];
/** Invoice presets. Escrow credit waits for OpenNode chain sweep (≥0.002 BTC). */
const LN_PRESETS_SATS = [25_000, 50_000, 100_000, 500_000];

export type DonateBindOpts = {
  address: string;
  proposalId: string | null;
  proposalPath: string;
  proposalTitle?: string;
  /** Project funder credit flow (default) vs endowment (anonymous, dedicated LN path). */
  mode?: "project" | "endowment";
  signedIn?: boolean;
  onAuthed?: () => void;
  onCreditLinked?: () => void;
  /** Confirmed escrow balance when the page loaded (for live funding updates). */
  initialBalance?: number | null;
  claimFloorSats?: number;
  targetSats?: number | null;
  /** Called when confirmed escrow balance changes (updates funding bar). */
  onBalanceUpdate?: (balance: number) => void;
  /** Account default prefs (skip credit step when present). */
  creditPrefs?: CreditPreferences | null;
  /** Override UTXO poll interval (tests use a short value). */
  utxoPollMs?: number;
  /** Override confirmed-balance poll interval (tests use a short value). */
  balancePollMs?: number;
};

function donateCreditStepHtml(signedIn: boolean): string {
  if (!signedIn) {
    return `<section class="donate-step" data-donate-step="credit" id="donate-step-credit">
      <div class="donate-panel-head">
        <h2 class="donate-title" id="donate-modal-title">Get credit for this donation</h2>
        <p class="donate-lede">Sign in to appear on the funder list and get updates. Amounts stay private unless you opt in.</p>
      </div>
      <aside class="donate-credit-advisory" role="note">
        <p>Anonymous gifts still fund the project. <button type="button" class="donate-credit-signin" id="donate-credit-signin-credit">sign in first</button> if you want credit later.</p>
      </aside>
      <div class="donate-credit-login">
        ${loginChoicesHtml(undefined, currentReturnPath())}
        <p class="builder-msg" id="donate-credit-login-msg" hidden></p>
      </div>
      <div class="donate-step-actions">
        <button type="button" class="btn ghost" id="donate-credit-continue">Continue anonymously</button>
      </div>
    </section>`;
  }
  return `<section class="donate-step" data-donate-step="credit" id="donate-step-credit">
    <div class="donate-panel-head">
      <p class="donate-step-kicker">Step 1 of 2</p>
      <h2 class="donate-title" id="donate-modal-title">Funder credit</h2>
      <p class="donate-lede">How you appear on the funder list. Amounts stay private unless you opt in.</p>
    </div>
    ${creditPreferenceFieldsHtml({ idPrefix: "donate-credit" })}
    <div class="donate-step-actions">
      <button type="button" class="btn" id="donate-credit-continue">Continue to payment</button>
    </div>
  </section>`;
}

function donatePayStepHtml(
  addr: string,
  networkNote: string,
  onchainPresets: string,
  lnPresets: string,
  signedIn: boolean,
  opts?: { endowment?: boolean },
): string {
  const endowment = Boolean(opts?.endowment);
  const head = `<div class="donate-panel-head">
      ${signedIn ? `<p class="donate-step-kicker">Step 2 of 2</p>` : ""}
      <h2 class="donate-title" id="donate-pay-title">${
        endowment ? "Donate to the endowment" : "Donate"
      }</h2>
      ${
        signedIn
          ? `<p class="donate-credit-summary muted" id="donate-credit-summary" hidden></p>
             <button type="button" class="donate-credit-edit" id="donate-credit-edit">Change credit preferences</button>
             <label class="donate-amount-label" for="donate-legal-name">Legal name for tax receipt (optional)</label>
             <input id="donate-legal-name" class="donate-amount" type="text" maxlength="120" autocomplete="name" />
             <p class="muted donate-legal-hint">Private. Used for a receipt after confirmation.</p>`
          : `<aside class="donate-credit-advisory" role="note">
               <p>Giving anonymously. <button type="button" class="donate-credit-signin" id="donate-credit-signin">sign in first</button> for credit or a later refund.</p>
             </aside>`
      }
    </div>`;
  const lnIntro = endowment
    ? "Pay now. Lands on-chain after the sweep (0.002 BTC min)."
    : "Pay now. Counts after the on-chain sweep (0.002 BTC min).";
  const creditBlock = endowment
    ? ""
    : `<div class="donate-credit-link" id="donate-credit">
      <div id="donate-credit-status" class="donate-credit-status" aria-live="polite" hidden></div>
      <div id="donate-credit-claim" class="donate-credit-claim" hidden></div>
    </div>`;

  return `<section class="donate-step" data-donate-step="pay" id="donate-step-pay" hidden>
    ${head}
    ${networkNote}
    <div class="donate-rails" role="tablist" aria-label="How to donate">
      <button type="button" class="donate-rail active" role="tab" aria-selected="true" data-tab="onchain" id="donate-rail-onchain">
        <span class="donate-rail-kicker">Bitcoin</span>
        <span class="donate-rail-name">On-chain</span>
      </button>
      <button type="button" class="donate-rail" role="tab" aria-selected="false" data-tab="lightning" id="donate-rail-lightning">
        <span class="donate-rail-kicker">Lightning</span>
        <span class="donate-rail-name">Invoice</span>
      </button>
    </div>

    <div class="donate-pane donate-pane-onchain" data-pane="onchain" role="tabpanel" aria-labelledby="donate-rail-onchain">
      <div class="donate-pay-layout">
        <div class="donate-qr-wrap">
          <img class="donate-qr" id="donate-qr" alt="QR code for donation address" width="168" height="168" />
        </div>
        <div class="donate-pay-fields">
          <label class="donate-amount-label" for="donate-amount">Amount (optional, sats)</label>
          <div class="donate-amount-row">
            <input id="donate-amount" class="donate-amount mono" type="number" min="0" step="1000" placeholder="Any amount" />
          </div>
          <div class="donate-presets">${onchainPresets}</div>
          <code class="donate-address mono" id="donate-address" title="${escapeHtml(addr)}">${escapeHtml(addr)}</code>
          <div class="donate-actions">
            <button type="button" class="btn donate-copy" id="donate-copy" data-copy="${escapeHtml(addr)}">Copy address</button>
            <a class="btn ghost donate-wallet" id="donate-wallet" href="${escapeHtml(bitcoinUri(addr))}">Open wallet</a>
          </div>
          <a class="donate-explorer-link" href="${escapeHtml(`${MEMPOOL_WEB}/address/${encodeURIComponent(addr)}`)}" target="_blank" rel="noreferrer noopener">View on explorer</a>
        </div>
      </div>
      <p class="donate-watch-hint muted" id="donate-watch-hint">Payment is detected automatically.</p>
      <p class="donate-confirm-status" id="donate-confirm-status" aria-live="polite" hidden></p>
    </div>

    <div class="donate-pane" data-pane="lightning" role="tabpanel" aria-labelledby="donate-rail-lightning" hidden>
      <div id="donate-ln-ready" hidden>
        <p class="donate-pane-intro">${lnIntro}</p>
        <p class="donate-ln-login muted" id="donate-ln-login" hidden>
          Sign in to create a Lightning invoice. On-chain works without an account.
          <button type="button" class="donate-credit-signin" id="donate-ln-signin">Sign in</button>
        </p>
        <div id="donate-ln-compose">
          <p class="donate-ln-limits muted" id="donate-ln-limits" hidden></p>
          <label class="donate-amount-label" for="donate-ln-amount">Amount (sats)</label>
          <div class="donate-amount-row">
            <input id="donate-ln-amount" class="donate-amount mono" type="number" min="1" step="1000" placeholder="Amount" />
          </div>
          <div class="donate-presets donate-ln-presets">${lnPresets}</div>
          <p class="donate-ln-fee muted" id="donate-ln-fee" hidden></p>
          <div class="donate-actions donate-ln-create-row">
            <button type="button" class="btn" id="donate-ln-create">Create Lightning invoice</button>
          </div>
        </div>
        <div class="donate-ln-invoice" id="donate-ln-invoice" hidden>
          <p class="donate-ln-amount-echo" id="donate-ln-amount-echo" hidden></p>
          <div class="donate-pay-layout">
            <div class="donate-qr-wrap donate-qr-wrap-ln">
              <img class="donate-qr" id="donate-ln-qr" alt="QR code for Lightning invoice" width="168" height="168" />
            </div>
            <div class="donate-pay-fields">
              <code class="donate-address mono" id="donate-ln-bolt11"></code>
              <div class="donate-actions">
                <button type="button" class="btn donate-copy" id="donate-ln-copy">Copy invoice</button>
                <button type="button" class="btn ghost" id="donate-ln-webln" hidden>Pay with WebLN</button>
              </div>
            </div>
          </div>
          <p class="donate-ln-status" id="donate-ln-status" aria-live="polite"></p>
          <div class="donate-ln-receipt" id="donate-ln-receipt" hidden>
            <p class="donate-credit-seen">Save this payment id for refunds:</p>
            <code class="donate-address mono" id="donate-ln-swap-id"></code>
            <div class="donate-actions">
              <button type="button" class="btn" id="donate-ln-copy-swap">Copy swap id</button>
            </div>
          </div>
          <button type="button" class="btn ghost donate-ln-new" id="donate-ln-new" hidden>New Lightning invoice</button>
        </div>
        <p class="donate-ln-error error" id="donate-ln-error" hidden></p>
      </div>
      <div id="donate-ln-unavailable" class="donate-ln-unavailable">
        <p class="donate-ln-wait muted" id="donate-ln-wait">Checking availability…</p>
      </div>
    </div>

    ${creditBlock}
  </section>`;
}

function readLegalName(panel: ParentNode): string | undefined {
  const raw = panel.querySelector<HTMLInputElement>("#donate-legal-name")?.value || "";
  const cleaned = raw.trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

function creditSummaryText(prefs: CreditPreferences): string {
  if (prefs.anonymous || !prefs.public_credit) {
    return "Credit preference: anonymous (identity hidden).";
  }
  return prefs.show_amount
    ? "Credit preference: public identity + amount."
    : "Credit preference: public identity, amount hidden.";
}

export function formatProposalDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function statusClass(status: string): string {
  if (["listed", "claimable", "completed"].includes(status)) return "status-good";
  if (
    ["claimed", "in_review", "funding", "abandoned_vote", "underfunded"].includes(
      status,
    )
  ) {
    return "status-active";
  }
  if (
    ["declined", "rejected", "refunding", "redirected", "redirect_pending"].includes(
      status,
    )
  ) {
    return "status-bad";
  }
  return "status-neutral";
}

/** Status pill for cards/hero. Hidden for `listed` — being on the site already implies that. */
export function statusPillHtml(status: string): string {
  const s = String(status || "").toLowerCase();
  if (!s || s === "listed") return "";
  return `<span class="pill pill-status ${statusClass(s)}">${escapeHtml(statusLabel(s))}</span>`;
}

export type ProposalStep =
  | "List"
  | "Fund"
  | "Award"
  | "Build"
  | "Review"
  | "Rebuttal"
  | "Release";

export function proposalCurrentStep(p: Proposal): ProposalStep {
  const status = String(p.status || "");
  const isDirect = String(p.proposal_type || "bounty") === "direct";
  if (p.release_blocked_reason) return "Release";
  if (status === "completed") return "Release";
  if (status === "rejected") return "Rebuttal";
  if (status === "in_review") return "Review";
  if (status === "claimed") return "Build";
  if (status === "claimable" || status === "listed" || status === "funding") {
    if (isDirect) return "Fund";
    if (status === "claimable") return "Award";
    return "Fund";
  }
  if (status === "unindexed" || status === "pr_open") return "List";
  return "List";
}

export function proposalStepperHtml(p: Proposal): string {
  const isDirect = String(p.proposal_type || "bounty") === "direct";
  const current = proposalCurrentStep(p);
  const steps: ProposalStep[] = isDirect
    ? ["List", "Fund", "Build", "Review", "Release"]
    : ["List", "Fund", "Award", "Build", "Review", "Release"];
  if (current === "Rebuttal" && !steps.includes("Rebuttal")) {
    const i = steps.indexOf("Review");
    steps.splice(i + 1, 0, "Rebuttal");
  }
  const currentIdx = steps.indexOf(current === "Rebuttal" ? "Rebuttal" : current);
  return `<ol class="proposal-stepper" aria-label="Project path">
    ${steps
      .map((step, i) => {
        const state =
          i === currentIdx ? "current" : i < currentIdx ? "done" : "todo";
        return `<li class="proposal-step proposal-step-${state}"${
          state === "current" ? ' aria-current="step"' : ""
        }>${escapeHtml(step)}</li>`;
      })
      .join("")}
  </ol>`;
}

/** Lifecycle banners: funding window, milestones grace, keyholder stall, ballot. */
function lifecycleBanner(k: string, body: string, cls = ""): string {
  return `<div class="lifecycle-banner${cls ? ` ${cls}` : ""}" role="status"><span class="lifecycle-k">${k}</span><p>${body}</p></div>`;
}

function fundingWindowBanner(p: Proposal): string {
  if (!p.funding_window_ends_at) return "";
  const end = new Date(p.funding_window_ends_at);
  if (Number.isNaN(end.getTime())) return "";
  const days = Math.ceil((end.getTime() - Date.now()) / 86400_000);
  if (days >= 0 && days <= 30) {
    return lifecycleBanner(
      "Funding window",
      `${days} day${days === 1 ? "" : "s"} remaining`,
    );
  }
  if (days < 0 && ["listed", "funding", "declined_fundable"].includes(String(p.status))) {
    return lifecycleBanner("Funding window", "Window ended", "lifecycle-warn");
  }
  return "";
}

function milestonesBanner(p: Proposal, balance?: number | null): string {
  if (p.milestones_due_at && !p.milestones.length) {
    const due = new Date(p.milestones_due_at);
    if (!Number.isNaN(due.getTime())) {
      const overdue = Date.now() > due.getTime();
      return lifecycleBanner(
        "Milestones",
        overdue
          ? "This project needs a milestone list before it can pay out."
          : `Milestones due by ${due.toLocaleDateString()}`,
        overdue ? "lifecycle-warn" : "",
      );
    }
  }
  if (!p.milestones.length && balance != null && balance >= 1_000_000) {
    return lifecycleBanner("Milestones", "This project needs a milestone list.");
  }
  return "";
}

/** At most one banner. Priority: stall → open vote/refund → funding window → milestones. */
export function proposalLifecycleBannersHtml(
  p: Proposal,
  balance?: number | null,
): string {
  if (p.release_blocked_reason) {
    const seats = (p.release_blocked_seats || [])
      .filter((n) => n >= 1 && n <= 5)
      .map((n) => `seat ${n}`);
    const seatLine = seats.length ? ` Unsigned: ${seats.join(", ")}.` : "";
    return lifecycleBanner(
      "Release stalled",
      `${escapeHtml(p.release_blocked_reason)}${escapeHtml(seatLine)}`,
      "lifecycle-stall",
    );
  }
  if (String(p.status) === "abandoned_vote") {
    return lifecycleBanner(
      "Vote open",
      "Donors are voting: extend, refund, or move remaining funds.",
    );
  }
  if (String(p.status) === "underfunded") {
    if (balance != null && balance > 0) {
      return lifecycleBanner(
        "Vote open",
        "Funding ended short. Donors are voting: extend, refund, or move remaining funds.",
      );
    }
    return lifecycleBanner(
      "Underfunded",
      "Funding ended before this project could open.",
      "lifecycle-warn",
    );
  }
  if (String(p.status) === "refunding") {
    return lifecycleBanner(
      "Refunding",
      `Add a refund address below. Track it in <a href="${href("/account", "?tab=funds")}">Account</a>.`,
      "lifecycle-warn",
    );
  }
  if (
    String(p.status) === "redirect_pending" ||
    String(p.status) === "redirected"
  ) {
    const target = String(
      (p as Proposal & { redirect_to?: string }).redirect_to || "",
    ).trim();
    const label =
      String(p.status) === "redirected" ? "Redirected" : "Redirect pending";
    return lifecycleBanner(
      label,
      `Donors voted to move remaining funds${
        target ? ` to <code class="mono">${escapeHtml(target)}</code>` : ""
      }.`,
      "lifecycle-warn",
    );
  }
  return fundingWindowBanner(p) || milestonesBanner(p, balance);
}

/**
 * Compact meter for cards/lists.
 * Scale = max(floor, target) so claim floor is never shown as the funding ceiling
 * when a soft target exists. Green to floor; tertiary toward target; orange past scale.
 */
export function fundingBarTrackHtml(
  funded: number,
  floor: number,
  variant: "progress" | "proposal-progress" = "proposal-progress",
  target: number | null = null,
): string {
  const safeFloor = Math.max(1, floor);
  const targetSats =
    target != null && Number.isFinite(target) && target > 0
      ? Math.floor(target)
      : 0;
  const scale = Math.max(safeFloor, targetSats || safeFloor);
  const fillPct = Math.min(100, (Math.max(0, funded) / scale) * 100);
  const floorPct = Math.min(100, (safeFloor / scale) * 100);

  if (funded <= safeFloor || scale <= safeFloor) {
    return `<div class="${variant}" role="progressbar" aria-valuemin="0" aria-valuemax="${scale}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${fillPct}%"></span></div>`;
  }
  if (funded <= scale) {
    const greenPct = Math.min(fillPct, floorPct);
    const restPct = Math.max(0, fillPct - greenPct);
    return `<div class="${variant}" role="progressbar" aria-valuemin="0" aria-valuemax="${scale}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${greenPct}%"></span>${
      restPct > 0
        ? `<span class="progress-toward-target" style="width:${restPct}%"></span>`
        : ""
    }</div>`;
  }
  const greenPct = Math.max(0.5, (safeFloor / funded) * 100);
  const orangePct = Math.max(0, 100 - greenPct);
  return `<div class="${variant} is-overfunded" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(funded)}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${greenPct}%"></span><span class="progress-over" style="width:${orangePct}%"></span></div>`;
}

export type FundingBarMarker = {
  sats: number;
  kind: "floor" | "threshold";
  id?: string;
  label?: string;
};

/** Scale + markers for detail funding bar (claim floor always; optional thresholds). */
export function fundingBarScale(
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
): { scale: number; markers: FundingBarMarker[] } {
  const safeFloor = Math.max(1, floor);
  const thresholds: { sats: number; id?: string; label?: string }[] = [];
  for (const m of milestones) {
    const sats = m.funding_threshold_sats;
    if (typeof sats === "number" && Number.isFinite(sats) && sats >= 1) {
      thresholds.push({
        sats,
        id: m.id,
        label: m.id || undefined,
      });
    }
  }
  const highest = thresholds.reduce((m, t) => Math.max(m, t.sats), 0);
  const targetSats =
    target != null && Number.isFinite(target) && target > 0
      ? Math.floor(target)
      : 0;
  const scale = Math.max(safeFloor, targetSats || safeFloor, highest);
  const markers: FundingBarMarker[] = [
    { sats: safeFloor, kind: "floor", label: "Opens" },
  ];
  for (const t of thresholds) {
    markers.push({
      sats: Math.floor(t.sats),
      kind: "threshold",
      id: t.id,
      label: t.label,
    });
  }
  markers.sort((a, b) => a.sats - b.sats);
  return { scale, markers };
}

function fundingDetailTrackHtml(
  funded: number,
  floor: number,
  scale: number,
  markers: FundingBarMarker[],
  /** When false, claimed/closed listings avoid "Opens for builders" / open-floor wording. */
  openCopy = true,
): string {
  const safeScale = Math.max(1, scale);
  const fillPct = Math.min(100, (funded / safeScale) * 100);
  const overTarget = funded > safeScale;
  const showLocks = markers.some((m) => m.kind === "threshold");
  const ticks = markers
    .map((m) => {
      const left = Math.min(100, Math.max(0, (m.sats / safeScale) * 100));
      const unlocked = funded >= m.sats;
      const lock =
        showLocks && m.kind === "threshold"
          ? unlocked
            ? ""
            : `<span class="funding-marker-lock" aria-hidden="true"></span>`
          : "";
      const state = unlocked ? "is-unlocked" : "is-locked";
      const kind = m.kind === "floor" ? "floor" : "threshold";
      const label =
        m.kind === "floor"
          ? openCopy
            ? `Opens for builders at ${m.sats.toLocaleString()} sats, ${unlocked ? "reached" : "not yet"}`
            : `Claim floor ${m.sats.toLocaleString()} sats, ${unlocked ? "reached" : "not yet"}`
          : `Milestone ${m.label || m.id || ""} ${m.sats.toLocaleString()} sats, ${unlocked ? "unlocked" : "locked"}`;
      return `<span class="funding-marker funding-marker-${kind} ${state}" style="left:${left}%" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${lock}<span class="funding-marker-tick"></span></span>`;
    })
    .join("");
  const overClass = overTarget ? " is-overfunded" : "";
  const floorPct = Math.min(100, (Math.max(1, floor) / safeScale) * 100);
  let fillHtml: string;
  if (funded <= Math.max(1, floor) || floor >= safeScale) {
    fillHtml = `<span class="progress-floor" style="width:${fillPct}%"></span>`;
  } else if (funded <= safeScale) {
    const greenPct = Math.min(fillPct, floorPct);
    const restPct = Math.max(0, fillPct - greenPct);
    fillHtml = `<span class="progress-floor" style="width:${greenPct}%"></span>${
      restPct > 0
        ? `<span class="progress-toward-target" style="width:${restPct}%"></span>`
        : ""
    }`;
  } else {
    const greenPct = Math.max(0.5, (Math.max(1, floor) / funded) * 100);
    const orangePct = Math.max(0, 100 - greenPct);
    fillHtml = `<span class="progress-floor" style="width:${greenPct}%"></span><span class="progress-over" style="width:${orangePct}%"></span>`;
  }
  return `<div class="proposal-progress proposal-progress-detail${overClass}" role="progressbar" aria-valuemin="0" aria-valuemax="${safeScale}" aria-valuenow="${Math.round(funded)}">
      <div class="proposal-progress-fill">${fillHtml}</div>
      <div class="funding-markers">${ticks}</div>
    </div>`;
}

/** Soft target only — claim floor is a minimum to start work, never a funding ceiling. */
export function fundingTargetSats(target: number | null | undefined): number | null {
  if (target != null && Number.isFinite(target) && target > 0) {
    return Math.floor(target);
  }
  return null;
}

/** True only when funded past the soft target (not merely past the claim floor). */
export function isPastFundingTarget(
  funded: number,
  target: number | null | undefined,
): boolean {
  const t = fundingTargetSats(target);
  return t != null && funded > t;
}

export function overfundRatioLabel(funded: number, target: number): string {
  const ratio = funded / Math.max(1, target);
  if (ratio < 1.05) return "";
  const pretty =
    ratio >= 100
      ? `${Math.round(ratio)}×`
      : ratio >= 10
        ? `${ratio.toFixed(0)}×`
        : `${ratio.toFixed(1)}×`;
  return `${pretty} target`;
}

/** Optional lifecycle fields so the meter does not say Open to apply when awarded. */
export type FundingProgressContext = {
  status?: string | null;
  claimer?: string | null;
  proposal_type?: string | null;
};

function fundingClosedLabel(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "claimed") return "Claimed";
  if (s === "in_review") return "In review";
  if (s === "rejected") return "Rejected";
  if (s === "completed") return "Completed";
  return "Applications closed";
}

export function fundingProgressHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
  ctx: FundingProgressContext = {},
): string {
  const funded = balance ?? 0;
  const { scale, markers } = fundingBarScale(floor, target, milestones);
  const pastFloor = funded >= floor;
  const eligibility = {
    status: ctx.status ?? "claimable",
    claimer: ctx.claimer ?? null,
    balance_sats: funded,
    proposal_type: ctx.proposal_type ?? "bounty",
  } as Proposal;
  const open = isOpenToClaim(eligibility, floor);
  const taken =
    isTakenStatus(String(eligibility.status)) || Boolean(eligibility.claimer);
  const targetSats = fundingTargetSats(target);
  const over = isPastFundingTarget(funded, targetSats);
  const remaining = Math.max(0, floor - funded);
  const overLabel = over && targetSats ? overfundRatioLabel(funded, targetSats) : "";
  const hasTarget = targetSats != null;
  const floorPct = Math.min(
    999,
    Math.round((funded / Math.max(1, floor)) * 100),
  );
  const targetPct = hasTarget
    ? Math.min(999, Math.round((funded / Math.max(1, targetSats!)) * 100))
    : floorPct;
  const label = over
    ? `Overfunded${overLabel ? ` · ${overLabel}` : ""}`
    : open
      ? "Open to apply"
      : taken
        ? fundingClosedLabel(String(eligibility.status))
        : pastFloor
          ? isDirectProposal(eligibility)
            ? "Receiving"
            : "Applications closed"
          : `${formatSats(remaining)} to open`;
  const labelClass = over
    ? " overfunded"
    : open
      ? " claimable"
      : "";
  // Always name the claim floor — never let target_sats look like the floor.
  // Only say "to open" while still funding toward / open for apply; claimed etc. use "floor".
  const openCopy = !taken && (open || !pastFloor);
  const floorWord = openCopy ? "to open" : "floor";
  const goalLine = hasTarget
    ? `${formatSats(funded)} / ${formatSats(floor)} ${floorWord} (${floorPct}%) · goal ${formatSats(target!)} (${targetPct}%)`
    : `${formatSats(funded)} / ${formatSats(floor)} ${floorWord} · ${floorPct}%`;
  return `<div class="funding-meter" data-funding-scale="${scale}">
      <div class="funding-meter-top">
        <span class="funding-meter-label${labelClass}">${label}</span>
        <span class="funding-meter-goal sats">${goalLine}</span>
      </div>
      ${fundingDetailTrackHtml(funded, floor, scale, markers, openCopy)}
    </div>`;
}

/** Slim funding strip under the hero: progress only, no duplicate stat cards. */
export function proposalFundingBarHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
  ctx: FundingProgressContext = {},
): string {
  return `<div class="proposal-funding-bar" data-milestones="${milestones.length}">
    ${fundingProgressHtml(balance, floor, target, milestones, ctx)}
  </div>`;
}

/** Replace the live funding bar when confirmed balance changes. */
export function updateProposalFundingBar(
  root: ParentNode,
  balance: number,
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
  ctx: FundingProgressContext = {},
): void {
  const host = root.querySelector(".proposal-funding-bar");
  if (!host) return;
  const prevUnlocked = new Set(
    [...host.querySelectorAll(".funding-marker.is-unlocked")].map(
      (el) => (el as HTMLElement).style.left,
    ),
  );
  host.innerHTML = fundingProgressHtml(balance, floor, target, milestones, ctx);
  for (const el of host.querySelectorAll(".funding-marker.is-unlocked")) {
    const left = (el as HTMLElement).style.left;
    if (!prevUnlocked.has(left) && el.classList.contains("funding-marker-threshold")) {
      el.classList.add("funding-marker-pulse");
    }
  }
}

function copyBtn(value: string, label: string): string {
  return `<button type="button" class="copy-btn" data-copy="${escapeHtml(value)}" title="Copy ${escapeHtml(label)}">Copy</button>`;
}

function explorerLink(href: string, label: string): string {
  return `<a class="explorer-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
}

/** Compact control that opens the donate modal (lives in the actions group). */
export function donateTriggerHtml(): string {
  return `<button type="button" class="btn donate-open-btn" id="donate-open" data-open-donate>${btnWithIcon("bitcoin-sign", "Donate")}</button>`;
}

/** Sticky mobile CTA — same open handler as #donate-open via data-open-donate. */
export function donateMobileCtaHtml(): string {
  return `<div class="proposal-mobile-cta">
    <button type="button" class="btn donate-open-btn" data-open-donate>${btnWithIcon("bitcoin-sign", "Donate")}</button>
  </div>`;
}

/** Absolute canonical URL for sharing a project page. */
export function proposalShareUrl(repoPath: string, id?: string | null): string {
  return new URL(proposalHref(repoPath, id), SITE_ORIGIN).toString();
}

/** Single Share control — destinations live in the share sheet / OS share. */
export function shareSlotHtml(
  title: string,
  repoPath: string,
  id?: string | null,
): string {
  const url = proposalShareUrl(repoPath, id);
  const text = `${title}: fund open Bitcoin work on Plebly`;
  return `<div class="proposal-share-slot">
    <button type="button" class="btn ghost proposal-share-btn" data-share="native" data-share-url="${escapeHtml(url)}" data-share-title="${escapeHtml(title)}" data-share-text="${escapeHtml(text)}">${btnWithIcon("share-nodes", "Share")}</button>
  </div>`;
}

export function bindShareButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-share="native"]').forEach((el) => {
    if (el.dataset.shareBound === "1") return;
    el.dataset.shareBound = "1";
    el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const url = el.dataset.shareUrl;
      if (!url) return;
      const shareTitle = el.dataset.shareTitle || "Plebly";
      const shareText = el.dataset.shareText || shareTitle;
      const payload = { title: shareTitle, text: shareText, url };
      if (prefersNativeShare()) {
        try {
          await navigator.share(payload);
          return;
        } catch (error) {
          if ((error as Error).name === "AbortError") return;
          // Fall through to desktop menu when the OS sheet fails.
        }
      }
      await openShareMenu(payload);
    });
  });
}

/** Full donate flow inside a modal shell. */
export function donateModalHtml(
  p: Proposal,
  opts?: { signedIn?: boolean },
): string {
  if (!p.escrow_address) return "";
  return `<div class="site-modal donate-modal" id="donate-modal" hidden>
    <div class="site-modal-backdrop" data-close-donate tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card donate-modal-card" role="dialog" aria-modal="true" aria-labelledby="donate-modal-title">
      <button type="button" class="site-modal-close" id="donate-close" aria-label="Close">${solidIcon("xmark")}</button>
      ${donatePanelHtml(p, opts)}
    </div>
  </div>`;
}

function donatePresetButtons(): { onchain: string; ln: string } {
  return {
    onchain: DONATE_PRESETS_SATS.map(
      (sats) =>
        `<button type="button" class="donate-preset" data-rail="onchain" data-sats="${sats}">${formatSats(sats)}</button>`,
    ).join(""),
    ln: LN_PRESETS_SATS.map(
      (sats) =>
        `<button type="button" class="donate-preset" data-rail="ln" data-sats="${sats}">${formatSats(sats)}</button>`,
    ).join(""),
  };
}

/** Multi-step donate wizard: credit preferences, then payment rails. */
export function donatePanelHtml(
  p: Proposal,
  opts?: { signedIn?: boolean },
): string {
  if (!p.escrow_address) return "";
  const addr = p.escrow_address;
  const signedIn = Boolean(opts?.signedIn);
  const networkNote = signetPayNoteHtml("donate");
  const presets = donatePresetButtons();

  return `<div class="donate-panel" id="donate" data-donate-step="credit">
    ${donateCreditStepHtml(signedIn)}
    ${donatePayStepHtml(addr, networkNote, presets.onchain, presets.ln, signedIn)}
  </div>`;
}

/**
 * Endowment size + progress toward goal — same track as project funding bars.
 * When goal is unset (0), shows balance only.
 */
export function endowmentMeterHtml(
  currentSats: number,
  goalSats: number,
  opts?: { size?: "card" | "hero" },
): string {
  const current = Math.max(0, Math.floor(Number(currentSats) || 0));
  const goal = Math.max(0, Math.floor(Number(goalSats) || 0));
  const size = opts?.size === "hero" ? "hero" : "card";
  if (goal <= 0) {
    return `<div class="endowment-meter endowment-meter-${size}">
      <p class="endowment-meter-figures">
        <span class="endowment-meter-current mono">${escapeHtml(formatSats(current))}</span>
      </p>
    </div>`;
  }
  const met = current >= goal;
  const status =
    size === "hero" && met
      ? `<p class="endowment-meter-top"><span class="claimable">Goal met</span></p>`
      : "";
  return `<div class="endowment-meter endowment-meter-${size}">
    ${status}
    <p class="endowment-meter-figures mono">
      <span class="endowment-meter-current">${escapeHtml(current.toLocaleString("en-US"))}</span>
      <span class="endowment-meter-goal">/ ${escapeHtml(formatSats(goal))}</span>
    </p>
    ${fundingBarTrackHtml(current, goal, "progress", goal)}
  </div>`;
}

/** Endowment donate panel — credit step + payment rails (same shell as projects). */
export function endowmentDonatePanelHtml(
  address: string,
  opts?: { signedIn?: boolean },
): string {
  const addr = address.trim();
  if (!addr) return "";
  const signedIn = Boolean(opts?.signedIn);
  const networkNote = signetPayNoteHtml("donate");
  const presets = donatePresetButtons();
  return `<div class="donate-panel" id="donate" data-donate-step="credit" data-donate-mode="endowment">
    ${donateCreditStepHtml(signedIn)}
    ${donatePayStepHtml(addr, networkNote, presets.onchain, presets.ln, signedIn, {
      endowment: true,
    })}
  </div>`;
}

/** Endowment donate flow in the same modal shell as project donations. */
export function endowmentDonateModalHtml(
  address: string,
  opts?: { signedIn?: boolean },
): string {
  const panel = endowmentDonatePanelHtml(address, opts);
  if (!panel) return "";
  return `<div class="site-modal donate-modal" id="donate-modal" hidden>
    <div class="site-modal-backdrop" data-close-donate tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card donate-modal-card" role="dialog" aria-modal="true" aria-labelledby="donate-modal-title">
      <button type="button" class="site-modal-close" id="donate-close" aria-label="Close">${solidIcon("xmark")}</button>
      ${panel}
    </div>
  </div>`;
}

async function bindOnchainDonate(
  panel: Element,
  address: string,
): Promise<void> {
  const qrImg = panel.querySelector<HTMLImageElement>("#donate-qr");
  const amountInput = panel.querySelector<HTMLInputElement>("#donate-amount");
  const walletLink = panel.querySelector<HTMLAnchorElement>("#donate-wallet");
  const copyBtnEl = panel.querySelector<HTMLButtonElement>("#donate-copy");

  const sync = async (sats: number | null) => {
    const uri = bitcoinUri(address, sats);
    if (walletLink) walletLink.href = uri;
    if (qrImg) {
      try {
        qrImg.src = await QRCode.toDataURL(uri, {
          width: 168,
          margin: 1,
          color: themeQrColors(),
        });
      } catch {
        /* ignore */
      }
    }
  };

  const onchainPresets = () =>
    panel.querySelectorAll<HTMLButtonElement>('.donate-preset[data-rail="onchain"]');

  /** Highlight a preset only when the input matches it; otherwise none (implicit any). */
  const syncPresetActive = (sats: number | null) => {
    onchainPresets().forEach((btn) => {
      const preset = Number(btn.dataset.sats);
      btn.classList.toggle(
        "active",
        sats != null && Number.isFinite(preset) && preset === sats,
      );
    });
  };

  await sync(null);

  amountInput?.addEventListener("input", () => {
    const n = Number(amountInput.value);
    const sats = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    syncPresetActive(sats);
    void sync(sats);
  });

  onchainPresets().forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.sats ?? "";
      if (!raw) return;
      const sats = Number(raw);
      if (!Number.isFinite(sats) || sats <= 0) return;
      if (amountInput) amountInput.value = String(Math.floor(sats));
      syncPresetActive(Math.floor(sats));
      void sync(Math.floor(sats));
    });
  });

  copyBtnEl?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address);
      const prev = copyBtnEl.textContent;
      copyBtnEl.textContent = "Copied";
      copyBtnEl.classList.add("copied");
      setTimeout(() => {
        copyBtnEl.textContent = prev;
        copyBtnEl.classList.remove("copied");
      }, 1400);
    } catch {
      /* ignore */
    }
  });
}

function selectDonateRail(panel: Element, name: "onchain" | "lightning"): void {
  panel.querySelectorAll<HTMLButtonElement>(".donate-rail").forEach((rail) => {
    const on = rail.dataset.tab === name;
    rail.classList.toggle("active", on);
    rail.setAttribute("aria-selected", on ? "true" : "false");
  });
  panel.querySelectorAll<HTMLElement>(".donate-pane").forEach((pane) => {
    pane.hidden = pane.dataset.pane !== name;
  });
}

function bindDonateRails(panel: Element): void {
  panel.querySelectorAll<HTMLButtonElement>(".donate-rail").forEach((rail) => {
    rail.addEventListener("click", () => {
      const name = rail.dataset.tab === "lightning" ? "lightning" : "onchain";
      selectDonateRail(panel, name);
    });
  });
  if (/(?:^|[?&])(?:rail=lightning|donate=ln)(?:&|$)/.test(location.search)) {
    selectDonateRail(panel, "lightning");
  }
}

function setLightningUnavailable(panel: Element, reason: string): void {
  const ready = panel.querySelector<HTMLElement>("#donate-ln-ready");
  const unavail = panel.querySelector<HTMLElement>("#donate-ln-unavailable");
  const wait = panel.querySelector<HTMLElement>("#donate-ln-wait");
  if (ready) ready.hidden = true;
  if (unavail) unavail.hidden = false;
  if (wait) wait.textContent = reason;
  panel
    .querySelector<HTMLButtonElement>("#donate-rail-lightning")
    ?.classList.add("donate-rail-limited");
}

function setLightningReady(panel: Element): void {
  const ready = panel.querySelector<HTMLElement>("#donate-ln-ready");
  const unavail = panel.querySelector<HTMLElement>("#donate-ln-unavailable");
  if (ready) ready.hidden = false;
  if (unavail) unavail.hidden = true;
  panel
    .querySelector<HTMLButtonElement>("#donate-rail-lightning")
    ?.classList.remove("donate-rail-limited");
}

function setDonateStatusEl(
  el: HTMLElement | null,
  message: string | null,
  kind?: "ok" | "bad" | "live",
): void {
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("ok", "bad", "live");
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("bad", kind === "bad");
  el.classList.toggle("live", kind === "live");
}

function setDonateCreditStatus(panel: Element, message: string | null, kind?: "ok" | "bad" | "live"): void {
  setDonateStatusEl(panel.querySelector<HTMLElement>("#donate-credit-status"), message, kind);
}

function setDonateConfirmStatus(panel: Element, message: string | null, kind?: "ok" | "bad" | "live"): void {
  setDonateStatusEl(panel.querySelector<HTMLElement>("#donate-confirm-status"), message, kind);
}

function setDonateStep(panel: Element, step: "credit" | "pay"): void {
  panel.setAttribute("data-donate-step", step);
  panel.querySelectorAll<HTMLElement>(".donate-step").forEach((el) => {
    el.hidden = el.dataset.donateStep !== step;
  });
  const dialog = panel.closest<HTMLElement>("[aria-labelledby]");
  if (dialog) {
    dialog.setAttribute(
      "aria-labelledby",
      step === "credit" ? "donate-modal-title" : "donate-pay-title",
    );
  }
}

function syncCreditSummary(panel: Element, prefs: CreditPreferences): void {
  const summary = panel.querySelector<HTMLElement>("#donate-credit-summary");
  if (!summary) return;
  summary.hidden = false;
  summary.textContent = creditSummaryText(prefs);
}

function activeCreditPreferences(panel: Element): CreditPreferences {
  const fromFields = panel.querySelector("#donate-credit-public")
    ? readCreditPreferences(panel, "donate-credit")
    : null;
  return fromFields || loadStoredCreditPreferences() || {
    public_credit: true,
    anonymous: false,
    show_amount: false,
  };
}

async function resolveInitialDonateStep(
  opts: DonateBindOpts,
): Promise<{ step: "credit" | "pay"; prefs: CreditPreferences | null }> {
  if (opts.creditPrefs) {
    const prefs = syncStoredCreditPreferencesFromProfile(opts.creditPrefs);
    if (prefs) return { step: "pay", prefs };
  }

  const stored = loadStoredCreditPreferences();
  if (stored) return { step: "pay", prefs: stored };

  if (opts.signedIn && opts.proposalId && WORKERS_API) {
    try {
      const res = await authFetch(
        `${WORKERS_API.replace(/\/$/, "")}/contributions/mine/${encodeURIComponent(opts.proposalId)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          contributions?: Array<{
            public_credit: boolean;
            anonymous: boolean;
            show_amount: boolean;
          }>;
        };
        const first = data.contributions?.[0];
        if (first) {
          const prefs: CreditPreferences = {
            public_credit: first.public_credit && !first.anonymous,
            anonymous: first.anonymous || !first.public_credit,
            show_amount: Boolean(first.show_amount),
          };
          saveStoredCreditPreferences(prefs);
          return { step: "pay", prefs };
        }
      }
    } catch {
      /* fall through to credit step */
    }
  }

  return { step: "credit", prefs: null };
}

/** Wire credit step + pay step navigation; polls mempool on pay for confirmations. */
function bindDonateWizard(panel: Element, opts: DonateBindOpts): void {
  bindCreditPreferenceGates(panel, "donate-credit");
  if (opts.onAuthed) bindLoginHandlers(opts.onAuthed);

  const claimWrap = panel.querySelector<HTMLElement>("#donate-credit-claim");
  let utxoStop: (() => void) | null = null;
  let balanceStop: (() => void) | null = null;
  let linking = false;

  const stopWatchers = () => {
    utxoStop?.();
    balanceStop?.();
    utxoStop = null;
    balanceStop = null;
  };
  (panel as HTMLElement & { __stopDonateWatchers?: () => void }).__stopDonateWatchers =
    stopWatchers;

  const setWatchHintVisible = (visible: boolean) => {
    const hint = panel.querySelector<HTMLElement>("#donate-watch-hint");
    if (hint) hint.hidden = !visible;
  };

  const linkOutpoint = async (utxo: {
    txid: string;
    vout: number;
    value: number;
  }) => {
    if (!opts.proposalId || !opts.signedIn || linking) return;
    linking = true;
    setWatchHintVisible(false);
    setDonateConfirmStatus(panel, "Linking funder credit…", "live");
    setDonateCreditStatus(panel, null);
    try {
      const prefs = activeCreditPreferences(panel);
      await recordContribution({
        proposal_id: opts.proposalId,
        txid: utxo.txid,
        vout: utxo.vout,
        address: opts.address,
        anonymous: prefs.anonymous || !prefs.public_credit,
        public_credit: prefs.public_credit && !prefs.anonymous,
        legal_name: readLegalName(panel),
        proposal_path: opts.proposalPath,
        proposal_title: opts.proposalTitle,
      });
      if (opts.mode !== "endowment") {
        await claimContributionWithRetry({
          proposal_id: opts.proposalId,
          txid: utxo.txid,
          vout: utxo.vout,
          legal_name: readLegalName(panel),
          proposal_path: opts.proposalPath,
          proposal_title: opts.proposalTitle,
          ...prefs,
        });
      }
      setDonateConfirmStatus(
        panel,
        `Credit linked for ${formatSats(utxo.value)}. Receipt appears in Account after confirmation.`,
        "ok",
      );
      if (claimWrap) claimWrap.hidden = true;
      opts.onCreditLinked?.();
    } catch (e) {
      setDonateConfirmStatus(panel, (e as Error).message, "bad");
      showClaimable([utxo]);
    } finally {
      linking = false;
    }
  };

  const showAnonymousReceipt = (utxo: {
    txid: string;
    vout: number;
    value: number;
  }) => {
    if (opts.proposalId) {
      void recordContribution({
        proposal_id: opts.proposalId,
        txid: utxo.txid,
        vout: utxo.vout,
        address: opts.address,
        anonymous: true,
        public_credit: false,
      }).catch(() => undefined);
    }
    if (!claimWrap) return;
    const outpoint = `${utxo.txid}:${utxo.vout}`;
    try {
      sessionStorage.setItem(
        `plebly:donate-receipt:${opts.address}`,
        JSON.stringify({
          rail: "onchain",
          txid: utxo.txid,
          vout: utxo.vout,
          value: utxo.value,
          at: Date.now(),
        }),
      );
    } catch {
      /* ignore */
    }
    claimWrap.hidden = false;
    claimWrap.innerHTML = `<p class="donate-credit-seen">Save this receipt for refunds (sign in later to register):</p>
      <ul class="donate-credit-utxos"><li>
        <span class="mono" title="${escapeHtml(outpoint)}">${escapeHtml(utxo.txid.slice(0, 12))}…:${utxo.vout}</span>
        <span>${escapeHtml(formatSats(utxo.value))}</span>
        <button type="button" class="btn" data-copy-receipt="${escapeHtml(outpoint)}">Copy receipt</button>
      </li></ul>`;
    claimWrap
      .querySelector<HTMLButtonElement>("[data-copy-receipt]")
      ?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        const value = btn.dataset.copyReceipt || "";
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          const prev = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = prev;
          }, 1400);
        } catch {
          /* ignore */
        }
      });
    setDonateConfirmStatus(
      panel,
      `Payment seen · receipt ${utxo.txid.slice(0, 12)}…:${utxo.vout}`,
      "ok",
    );
  };

  const showClaimable = (utxos: { txid: string; vout: number; value: number }[]) => {
    if (!claimWrap || !utxos.length || !opts.proposalId) return;
    if (!opts.signedIn) {
      showAnonymousReceipt(utxos[0]!);
      return;
    }
    claimWrap.hidden = false;
    claimWrap.innerHTML = `<p class="donate-credit-seen">Couldn’t auto-link — pick your payment:</p>
      <ul class="donate-credit-utxos">${utxos
        .map(
          (u) => `<li>
            <span class="mono">${escapeHtml(u.txid.slice(0, 12))}…:${u.vout}</span>
            <span>${escapeHtml(formatSats(u.value))}</span>
            <button type="button" class="btn" data-claim-txid="${escapeHtml(u.txid)}" data-claim-vout="${u.vout}" data-claim-value="${u.value}">Link this</button>
          </li>`,
        )
        .join("")}</ul>`;
    claimWrap.querySelectorAll<HTMLButtonElement>("[data-claim-txid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const txid = btn.dataset.claimTxid || "";
        const vout = Number(btn.dataset.claimVout);
        const value = Number(btn.dataset.claimValue);
        if (!txid || !Number.isFinite(vout)) return;
        void linkOutpoint({ txid, vout, value: Number.isFinite(value) ? value : 0 });
      });
    });
  };

  const startBalanceWatch = () => {
    if (balanceStop) return;
    const watcher = watchConfirmedBalance(
      opts.address,
      (balance, { previous }) => {
        const delta = balance - previous;
        setWatchHintVisible(false);
        const statusEl = panel.querySelector<HTMLElement>("#donate-confirm-status");
        const alreadyLinked =
          statusEl?.textContent?.toLowerCase().includes("credit linked") ?? false;
        if (!alreadyLinked) {
          setDonateConfirmStatus(
            panel,
            delta > 0
              ? `Confirmed · ${formatSats(delta)} added · escrow ${formatSats(balance)}`
              : `Escrow balance is now ${formatSats(balance)}.`,
            "ok",
          );
        }
        opts.onBalanceUpdate?.(balance);
      },
      {
        baseline:
          typeof opts.initialBalance === "number" && Number.isFinite(opts.initialBalance)
            ? opts.initialBalance
            : undefined,
        intervalMs: opts.balancePollMs ?? 10_000,
      },
    );
    balanceStop = watcher.stop;
  };

  const startUtxoWatch = () => {
    if (utxoStop) return;
    const watcher = watchNewUtxos(
      opts.address,
      (utxos) => {
        if (!utxos.length) return;
        setWatchHintVisible(false);
        if (utxos.some((u) => !u.status?.confirmed)) {
          setDonateConfirmStatus(panel, "Payment seen · confirming…", "live");
        }
        const pick =
          utxos.find((u) => u.status?.confirmed) || utxos[0];
        if (!pick) return;
        if (opts.signedIn && opts.proposalId) {
          void linkOutpoint(pick);
          return;
        }
        showAnonymousReceipt(pick);
      },
      { intervalMs: opts.utxoPollMs ?? 8000 },
    );
    utxoStop = watcher.stop;
  };

  const restoreStoredReceipt = () => {
    try {
      const raw = sessionStorage.getItem(
        `plebly:donate-receipt:${opts.address}`,
      );
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        rail?: string;
        txid?: string;
        vout?: number;
        value?: number;
        swap_id?: string;
      };
      if (
        parsed.rail === "onchain" &&
        parsed.txid &&
        typeof parsed.vout === "number"
      ) {
        showAnonymousReceipt({
          txid: parsed.txid,
          vout: parsed.vout,
          value: Number(parsed.value) || 0,
        });
      }
    } catch {
      /* ignore */
    }
  };

  const goPay = (prefs: CreditPreferences) => {
    saveStoredCreditPreferences(prefs);
    if (opts.signedIn) {
      applyCreditPreferencesToFields(panel, prefs, "donate-credit");
      syncCreditSummary(panel, prefs);
    }
    setDonateStep(panel, "pay");
    setDonateCreditStatus(panel, null);
    setDonateConfirmStatus(panel, null);
    setWatchHintVisible(true);
    if (claimWrap) {
      claimWrap.hidden = true;
      claimWrap.innerHTML = "";
    }
    if (!opts.signedIn) restoreStoredReceipt();
    startBalanceWatch();
    startUtxoWatch();
  };

  panel.querySelector<HTMLButtonElement>("#donate-credit-continue")?.addEventListener(
    "click",
    () => {
      const prefs = opts.signedIn
        ? readCreditPreferences(panel, "donate-credit")
        : {
            public_credit: false,
            anonymous: true,
            show_amount: false,
          };
      goPay(prefs);
    },
  );

  panel.querySelector<HTMLButtonElement>("#donate-credit-edit")?.addEventListener(
    "click",
    () => {
      const stored = loadStoredCreditPreferences();
      if (stored) applyCreditPreferencesToFields(panel, stored, "donate-credit");
      setDonateStep(panel, "credit");
    },
  );

  panel.querySelectorAll<HTMLButtonElement>(".donate-credit-signin").forEach((btn) => {
    btn.addEventListener("click", () => {
      setDonateStep(panel, "credit");
      panel
        .querySelector<HTMLElement>("#donate-step-credit .login-choices a, #donate-step-credit .login-choices button")
        ?.focus();
    });
  });

  void resolveInitialDonateStep(opts).then(({ step, prefs }) => {
    if (prefs) {
      applyCreditPreferencesToFields(panel, prefs, "donate-credit");
      syncCreditSummary(panel, prefs);
    }
    if (step === "pay" && (prefs || hasStoredCreditPreferences())) {
      goPay(prefs || loadStoredCreditPreferences()!);
    } else {
      setDonateStep(panel, "credit");
    }
  });
}

async function linkLightningCredit(
  panel: Element,
  opts: DonateBindOpts,
  swapId: string,
): Promise<void> {
  if (!opts.signedIn || !opts.proposalId) return;
  setDonateCreditStatus(panel, "Linking Lightning funder credit…", "live");
  try {
    await claimContributionWithRetry({
      proposal_id: opts.proposalId,
      swap_id: swapId,
      ...activeCreditPreferences(panel),
    });
    setDonateCreditStatus(panel, "Lightning credit linked.", "ok");
    opts.onCreditLinked?.();
  } catch (e) {
    setDonateCreditStatus(
      panel,
      `${(e as Error).message} You can retry from Funders after the swap indexes.`,
      "bad",
    );
  }
}

function bindLightningDonate(
  panel: Element,
  opts: DonateBindOpts,
  status: LightningStatus,
): void {
  setLightningReady(panel);

  const amountInput = panel.querySelector<HTMLInputElement>("#donate-ln-amount");
  const feeEl = panel.querySelector<HTMLElement>("#donate-ln-fee");
  const createBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-create");
  const invoiceWrap = panel.querySelector<HTMLElement>("#donate-ln-invoice");
  const qrImg = panel.querySelector<HTMLImageElement>("#donate-ln-qr");
  const bolt11El = panel.querySelector<HTMLElement>("#donate-ln-bolt11");
  const copyBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-copy");
  const weblnBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-webln");
  const statusEl = panel.querySelector<HTMLElement>("#donate-ln-status");
  const errorEl = panel.querySelector<HTMLElement>("#donate-ln-error");
  const receiptEl = panel.querySelector<HTMLElement>("#donate-ln-receipt");
  const swapIdEl = panel.querySelector<HTMLElement>("#donate-ln-swap-id");
  const copySwapBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-copy-swap");
  const amountEcho = panel.querySelector<HTMLElement>("#donate-ln-amount-echo");
  const newBtn = panel.querySelector<HTMLButtonElement>("#donate-ln-new");
  const readyEl = panel.querySelector<HTMLElement>("#donate-ln-ready");
  let settledLinked = false;
  let waitingInvoice = false;

  const setLnPhase = (phase: "compose" | "wait" | "done") => {
    waitingInvoice = phase === "wait";
    if (readyEl) readyEl.dataset.lnPhase = phase;
  };

  const showSwapReceipt = (swapId: string) => {
    try {
      sessionStorage.setItem(
        `plebly:donate-receipt:${opts.address}`,
        JSON.stringify({ rail: "lightning", swap_id: swapId, at: Date.now() }),
      );
    } catch {
      /* ignore */
    }
    if (swapIdEl) swapIdEl.textContent = swapId;
    if (receiptEl) receiptEl.hidden = false;
  };

  const { min, max } = lightningLimits(status);
  const guestProject = opts.mode !== "endowment" && !opts.signedIn;
  const loginEl = panel.querySelector<HTMLElement>("#donate-ln-login");
  const limitsEl = panel.querySelector<HTMLElement>("#donate-ln-limits");
  if (loginEl) loginEl.hidden = !guestProject;
  if (createBtn && guestProject) {
    createBtn.disabled = true;
    createBtn.textContent = "Sign in to invoice";
  }
  panel.querySelector("#donate-ln-signin")?.addEventListener("click", () => {
    panel.querySelector<HTMLButtonElement>("#donate-credit-signin")?.click();
  });
  if (amountInput) {
    amountInput.min = String(min);
    amountInput.max = String(max);
    amountInput.placeholder = `${min}+`;
  }
  if (limitsEl) {
    limitsEl.hidden = false;
    limitsEl.textContent = `${formatSats(min)}–${formatSats(max)} per invoice.`;
  }

  // Drop presets outside processor limits
  panel.querySelectorAll<HTMLButtonElement>('.donate-preset[data-rail="ln"]').forEach((btn) => {
    const sats = Number(btn.dataset.sats);
    if (Number.isFinite(sats) && (sats < min || sats > max)) btn.hidden = true;
  });

  const updateFeeHint = () => {
    if (!feeEl || !amountInput) return;
    const n = Math.floor(Number(amountInput.value));
    if (!Number.isFinite(n) || n <= 0) {
      feeEl.hidden = true;
      return;
    }
    feeEl.hidden = false;
    feeEl.textContent = lightningFeeHint({
      status,
      mode: opts.mode === "endowment" ? "endowment" : "project",
    });
  };

  amountInput?.addEventListener("input", updateFeeHint);

  panel.querySelectorAll<HTMLButtonElement>('.donate-preset[data-rail="ln"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.sats ?? "";
      panel
        .querySelectorAll('.donate-preset[data-rail="ln"]')
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (amountInput && raw) amountInput.value = raw;
      updateFeeHint();
    });
  });

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const stopPoll = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const setError = (msg: string | null) => {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  };

  const renderSwap = async (swap: LightningSwapView) => {
    if (invoiceWrap) invoiceWrap.hidden = false;
    if (bolt11El) {
      bolt11El.textContent = swap.bolt11;
      bolt11El.title = swap.bolt11;
    }
    if (amountEcho && swap.invoice_amount_sats > 0) {
      amountEcho.hidden = false;
      amountEcho.textContent = `Invoice for ${formatSats(swap.invoice_amount_sats)}.`;
    }
    if (qrImg) {
      try {
        const bolt11 = swap.bolt11.trim();
        const uri = /^lightning:/i.test(bolt11)
          ? bolt11
          : `lightning:${bolt11}`;
        qrImg.src = await QRCode.toDataURL(uri.toUpperCase(), {
          width: 168,
          margin: 1,
          errorCorrectionLevel: "L",
          color: themeQrColors(),
        });
      } catch {
        /* ignore */
      }
    }
    if (weblnBtn) {
      weblnBtn.hidden = !(
        window as Window & { webln?: unknown }
      ).webln;
    }
    if (feeEl) {
      feeEl.hidden = false;
      feeEl.textContent = lightningFeeHint({
        status,
        mode: opts.mode === "endowment" ? "endowment" : "project",
        expectedOnchainSats: swap.expected_onchain_sats,
      });
    }
    if (swap.swap_id) showSwapReceipt(swap.swap_id);
    if (statusEl) {
      const sentence = lightningStatusSentence(swap.status, {
        error: swap.error,
        endowment: opts.mode === "endowment",
      });
      statusEl.textContent = sentence.text;
      statusEl.classList.toggle("live", sentence.kind === "live");
      statusEl.classList.toggle("ok", sentence.kind === "ok");
      statusEl.classList.toggle("bad", sentence.kind === "bad");
    }
    if (["failed", "expired"].includes(swap.status)) {
      setLnPhase("compose");
      if (newBtn) newBtn.hidden = false;
    } else if (swap.status === "settled") {
      setLnPhase("done");
      if (newBtn) newBtn.hidden = true;
    } else {
      setLnPhase("wait");
      if (newBtn) newBtn.hidden = true;
    }
  };

  const startPoll = (swapId: string, immediate = false) => {
    stopPoll();
    settledLinked = false;
    let delayMs = 8_000;
    const tick = async () => {
      if (document.hidden) {
        pollTimer = setTimeout(() => void tick(), delayMs);
        return;
      }
      try {
        const swap = await fetchLightningSwap(swapId);
        await renderSwap(swap);
        if (swap.status === "settled" && !settledLinked) {
          settledLinked = true;
          stopPoll();
          if (opts.mode !== "endowment") {
            void linkLightningCredit(panel, opts, swapId);
          }
          return;
        }
        if (["failed", "expired"].includes(swap.status)) {
          stopPoll();
          return;
        }
        delayMs = Math.min(delayMs + 4_000, 20_000);
      } catch {
        /* keep polling */
      }
      pollTimer = setTimeout(() => void tick(), delayMs);
    };
    pollTimer = setTimeout(() => void tick(), immediate ? 0 : delayMs);
  };

  const resetCompose = () => {
    stopPoll();
    waitingInvoice = false;
    setLnPhase("compose");
    if (invoiceWrap) invoiceWrap.hidden = true;
    if (newBtn) newBtn.hidden = true;
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove("live", "ok", "bad");
    }
    if (createBtn && !guestProject) {
      createBtn.disabled = false;
      createBtn.textContent = "Create Lightning invoice";
    }
  };

  createBtn?.addEventListener("click", async () => {
    if (waitingInvoice) return;
    setError(null);
    stopPoll();
    if (guestProject) {
      setError("Sign in to create a Lightning invoice.");
      return;
    }
    const amount = Math.floor(Number(amountInput?.value));
    const amountErr = lightningAmountError(amount, status);
    if (amountErr) {
      setError(amountErr);
      if (amountInput) amountInput.setAttribute("aria-invalid", "true");
      return;
    }
    amountInput?.removeAttribute("aria-invalid");
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = "Creating…";
    }
    try {
      const swap =
        opts.mode === "endowment"
          ? await createEndowmentLightningInvoice({
              amount_sats: amount,
              escrow_address: opts.address,
              anonymous: activeCreditPreferences(panel).anonymous,
              legal_name: readLegalName(panel),
            })
          : await createLightningInvoice({
              proposal_id: opts.proposalId,
              proposal_path: opts.proposalPath,
              escrow_address: opts.address,
              amount_sats: amount,
              legal_name: readLegalName(panel),
              proposal_title: opts.proposalTitle,
            });
      await renderSwap(swap);
      startPoll(swap.swap_id);
    } catch (e) {
      setError((e as Error).message);
      resetCompose();
    } finally {
      if (createBtn && !waitingInvoice) {
        createBtn.disabled = false;
        createBtn.textContent = "Create Lightning invoice";
      }
    }
  });

  newBtn?.addEventListener("click", () => {
    setError(null);
    resetCompose();
  });

  copyBtn?.addEventListener("click", async () => {
    const text = bolt11El?.textContent?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = prev;
      }, 1400);
    } catch {
      /* ignore */
    }
  });

  copySwapBtn?.addEventListener("click", async () => {
    const text = swapIdEl?.textContent?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = copySwapBtn.textContent;
      copySwapBtn.textContent = "Copied";
      setTimeout(() => {
        copySwapBtn.textContent = prev;
      }, 1400);
    } catch {
      /* ignore */
    }
  });

  weblnBtn?.addEventListener("click", async () => {
    const bolt11 = bolt11El?.textContent?.trim();
    if (!bolt11) return;
    setError(null);
    try {
      await weblnPay(bolt11);
      if (statusEl) {
        statusEl.textContent = "Payment sent. Waiting for confirmation.";
        statusEl.classList.add("live");
        statusEl.classList.remove("ok", "bad");
      }
    } catch (e) {
      setError((e as Error).message || "WebLN payment failed");
    }
  });

  try {
    const raw = sessionStorage.getItem(`plebly:donate-receipt:${opts.address}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { rail?: string; swap_id?: string };
      if (parsed.rail === "lightning" && parsed.swap_id) {
        void fetchLightningSwap(parsed.swap_id)
          .then(async (swap) => {
            await renderSwap(swap);
            if (!["failed", "expired", "settled"].includes(swap.status)) {
              startPoll(swap.swap_id);
            }
          })
          .catch(() => {
            showSwapReceipt(parsed.swap_id!);
          });
      }
    }
  } catch {
    /* ignore */
  }
}

export async function bindDonatePanel(
  root: ParentNode,
  opts: DonateBindOpts | string,
): Promise<void> {
  const panel = root.querySelector("#donate");
  if (!panel) return;

  const normalized: DonateBindOpts =
    typeof opts === "string"
      ? { address: opts, proposalId: null, proposalPath: "" }
      : opts;
  const endowment = normalized.mode === "endowment";

  // Wire rails + wizard before any network so Donate opens immediately for guests.
  bindDonateRails(panel);
  bindDonateWizard(panel, normalized);
  void bindOnchainDonate(panel, normalized.address);

  if (!endowment && !normalized.proposalPath) {
    setLightningUnavailable(
      panel,
      "Lightning needs a listed project path. Use on-chain for now.",
    );
    return;
  }

  if (!lightningUiAllowed()) {
    setLightningUnavailable(
      panel,
      BITCOIN_NETWORK === "signet"
        ? "Lightning isn’t available on signet. Use Bitcoin on-chain."
        : "Lightning isn’t available right now. Use Bitcoin on-chain.",
    );
    return;
  }

  const status = await fetchLightningStatus();
  if (!status.enabled) {
    setLightningUnavailable(
      panel,
      status.reason ||
        "Lightning invoices are unavailable right now. Use Bitcoin on-chain.",
    );
    return;
  }
  bindLightningDonate(panel, normalized, status);
}

export function bindDonateModal(
  root: ParentNode,
  opts?: { open?: boolean; rail?: "onchain" | "lightning" },
): void {
  const modal = root.querySelector<HTMLElement>("#donate-modal");
  const openBtns = [
    ...root.querySelectorAll<HTMLButtonElement>(
      "[data-open-donate], #donate-open",
    ),
  ];
  const closeBtn = root.querySelector<HTMLButtonElement>("#donate-close");
  const backdrop = root.querySelector<HTMLElement>("[data-close-donate]");
  const panel = root.querySelector("#donate");
  let lastOpener: HTMLButtonElement | null = openBtns[0] || null;

  const open = (ev?: Event) => {
    if (!modal) return;
    if (ev?.currentTarget instanceof HTMLButtonElement) {
      lastOpener = ev.currentTarget;
    }
    modal.hidden = false;
    document.body.classList.add("modal-open");
    if (opts?.rail === "lightning" && panel) {
      selectDonateRail(panel, "lightning");
    }
    closeBtn?.focus();
    window.addEventListener("keydown", onEscape);
  };

  const close = () => {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
    window.removeEventListener("keydown", onEscape);
    lastOpener?.focus();
  };

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && modal && !modal.hidden) close();
  };

  for (const btn of openBtns) btn.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  if (opts?.open) open();
}

export function onChainPanelHtml(p: Proposal): string {
  const rows: string[] = [];

  if (p.escrow_address) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Escrow address</span>
      <div class="onchain-value">
        <code class="mono">${escapeHtml(p.escrow_address)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/address/${encodeURIComponent(p.escrow_address)}`, "Explorer")}
          ${copyBtn(p.escrow_address, "address")}
        </span>
      </div>
    </div>`);
  }

  if (p.submission_fee_txid) {
    const tx = p.submission_fee_txid;
    const short = `${tx.slice(0, 8)}…${tx.slice(-8)}`;
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Submission fee</span>
      <div class="onchain-value">
        <code class="mono" title="${escapeHtml(tx)}">${escapeHtml(short)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/tx/${tx}`, "Explorer")}
          ${copyBtn(tx, "txid")}
        </span>
      </div>
    </div>`);
  }

  if (p.escrow_index != null) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Escrow index</span>
      <span class="onchain-inline-value">${escapeHtml(String(p.escrow_index))}</span>
    </div>`);
  }

  if (!rows.length) return "";
  return `<details class="proposal-onchain">
    <summary>On-chain details</summary>
    <div class="onchain-panel">${rows.join("")}</div>
  </details>`;
}

export function structuredFundingPanelHtml(p: Proposal): string {
  const type = String(p.proposal_type || "bounty").toLowerCase();
  if (type === "direct" || !p.escrow_address || !p.id) return "";
  return `<section class="proposal-structured" id="structured-funding" hidden>
    <h2 class="proposal-block-title">Structured funding</h2>
    <p class="muted structured-funding-status" id="structured-funding-status"></p>
    <div id="structured-funding-body"></div>
  </section>`;
}

type StructuredFundingView = {
  psbt_kind?: string;
  allocations?: { id: string; allocation_sats: number }[];
  reviewer_reserve_percent?: number;
  reserve_sats?: number;
  donate_address?: string;
  pool_refund_address?: string;
  structured?: {
    state?: string;
    sha256?: string;
    psbt_base64?: string;
    settle_txid?: string;
    decode?: {
      version?: number;
      locktime?: number;
      miner_fee_sats?: number;
      inputs?: { address: string; amount_sats: number }[];
      outputs?: { address: string; amount_sats: number; label?: string }[];
    };
  };
};

export function bindStructuredFunding(
  root: ParentNode,
  proposalId: string,
): void {
  const panel = root.querySelector<HTMLElement>("#structured-funding");
  const statusEl = root.querySelector<HTMLElement>("#structured-funding-status");
  const bodyEl = root.querySelector<HTMLElement>("#structured-funding-body");
  if (!panel || !statusEl || !bodyEl || !proposalId) return;
  const api = WORKERS_API.replace(/\/$/, "");
  void (async () => {
    try {
      const res = await fetch(
        `${api}/proposals/${encodeURIComponent(proposalId)}/structured-funding`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as StructuredFundingView;
      panel.hidden = false;
      const state = data.structured?.state || "awaiting_funds";
      const kind = data.psbt_kind === "milestone" ? "Type 2 (milestones)" : "Type 1 (single bounty)";
      statusEl.textContent =
        state === "awaiting_funds"
          ? `${kind} — waiting for confirmed funds to reach the frozen allocation, reviewer reserve, and miner fee.`
          : state === "confirmed"
            ? `${kind} — structured funding confirmed on-chain.`
            : `${kind} — unsigned structured-funding PSBT ready for keyholder review.`;
      bodyEl.innerHTML = structuredFundingBodyHtml(data);
      const branchRes = await fetch(
        `${api}/proposals/${encodeURIComponent(proposalId)}/branches`,
      );
      if (branchRes.ok) {
        const branches = (await branchRes.json()) as BranchPublicView;
        bodyEl.insertAdjacentHTML(
          "beforeend",
          branchListHtml(branches.branches, branches.selected, branches.signoff),
        );
        bindBranchHashGate(bodyEl, branches);
      }
      bindProposalCopyButtons(bodyEl);
    } catch {
      /* public view is optional */
    }
  })();
}

type BranchPublicView = {
  selected?: Record<string, { kind?: string; sha256?: string }>;
  signoff?: Record<
    string,
    {
      signed?: number;
      required_threshold?: number;
      state?: string;
      settle_txid?: string;
    }
  >;
  branches?: {
    state?: string;
    items?: {
      allocation_id: string;
      kind: string;
      sha256: string;
      locktime: number;
      psbt_base64?: string;
    }[];
  };
};

function selectedBranchHash(view: BranchPublicView): string {
  const selected = view.selected || {};
  for (const row of Object.values(selected)) {
    if (row?.sha256) return row.sha256;
  }
  const items = view.branches?.items || [];
  const clean = items.find((b) => b.kind === "clean");
  return clean?.sha256 || items[0]?.sha256 || "";
}

function bindBranchHashGate(root: ParentNode, view: BranchPublicView): void {
  const published = selectedBranchHash(view);
  bindHashGate({
    input: root.querySelector<HTMLTextAreaElement>("#branch-psbt-verify"),
    status: root.querySelector<HTMLElement>("#branch-hash-status"),
    publishedHash: published,
    action: root.querySelector<HTMLButtonElement>("#branch-sign-ready"),
    enableActionWithoutHash: false,
  });
  const btn = root.querySelector<HTMLButtonElement>("#branch-sign-ready");
  const input = root.querySelector<HTMLTextAreaElement>("#branch-psbt-verify");
  btn?.addEventListener("click", () => {
    if (btn.disabled) return;
    const b64 = input?.value.trim() || "";
    const item = (view.branches?.items || []).find((b) => b.sha256 === published);
    const copy = b64 || item?.psbt_base64 || "";
    if (!copy) return;
    void navigator.clipboard.writeText(copy).catch(() => undefined);
  });
}

function branchListHtml(
  branches?: BranchPublicView["branches"],
  selected?: BranchPublicView["selected"],
  signoff?: BranchPublicView["signoff"],
): string {
  if (!branches) return "";
  if (branches.state !== "ready" || !branches.items?.length) {
    return `<p class="muted structured-funding-status">Refund and timelock branches construct after structured funding confirms. Clean and disputed pay branches wait for an awarded on-chain payout.</p>`;
  }
  const picked = selected || {};
  const pickedSignoff = signoff || {};
  const rows = branches.items
    .map((b) => {
      const sel = picked[b.allocation_id];
      const isSel = sel?.kind === b.kind;
      const so = pickedSignoff[b.allocation_id];
      const signLabel =
        isSel && so
          ? ` · ${so.signed ?? 0}/${so.required_threshold ?? 0} signed${
              so.state === "settled" && so.settle_txid
                ? ` · settled ${so.settle_txid}`
                : so.state
                  ? ` · ${so.state}`
                  : ""
            }`
          : "";
      return `<tr${isSel ? ' class="is-selected"' : ""}>
        <td>${escapeHtml(b.allocation_id)}</td>
        <td>${escapeHtml(b.kind)}${isSel ? " · selected" : ""}${signLabel}</td>
        <td class="mono">${escapeHtml(b.sha256)}</td>
        <td>${escapeHtml(String(b.locktime))}</td>
        <td>${copyBtn(b.sha256, "hash")}${b.psbt_base64 ? copyBtn(b.psbt_base64, "PSBT") : ""}</td>
      </tr>`;
    })
    .join("");
  const published = selectedBranchHash({ selected, branches });
  return `<div class="structured-decode">
    <p class="onchain-label">Release branches (unsigned)</p>
    <table>
      <thead><tr><th>Output</th><th>Branch</th><th>SHA-256</th><th>Locktime</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${hashGateHtml({
      publishedHash: published,
      inputId: "branch-psbt-verify",
      statusId: "branch-hash-status",
    })}
    <button type="button" class="btn" id="branch-sign-ready" disabled>Hash matches — copy for Sparrow</button>
  </div>`;
}

function structuredFundingBodyHtml(data: StructuredFundingView): string {
  const rows: string[] = [];
  if (data.pool_refund_address) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Donor pool refund</span>
      <div class="onchain-value">
        <code class="mono">${escapeHtml(data.pool_refund_address)}</code>
        <span class="onchain-actions">${copyBtn(data.pool_refund_address, "address")}</span>
      </div>
    </div>`);
  }
  if (data.reserve_sats != null) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Reviewer reserve</span>
      <span class="onchain-inline-value">${escapeHtml(formatSats(data.reserve_sats))} (${escapeHtml(String(data.reviewer_reserve_percent ?? ""))}%)</span>
    </div>`);
  }
  const hash = data.structured?.sha256;
  if (hash) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">PSBT SHA-256</span>
      <div class="onchain-value">
        <code class="mono">${escapeHtml(hash)}</code>
        <span class="onchain-actions">${copyBtn(hash, "hash")}</span>
      </div>
    </div>`);
  }
  const decode = data.structured?.decode;
  if (decode) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Locktime / version / miner fee</span>
      <span class="onchain-inline-value">${escapeHtml(String(decode.locktime ?? 0))} / v${escapeHtml(String(decode.version ?? 2))} / ${escapeHtml(formatSats(decode.miner_fee_sats || 0))}</span>
    </div>`);
    const io = [
      ...(decode.inputs || []).map(
        (i) =>
          `<tr><td>in</td><td></td><td class="mono">${escapeHtml(i.address)}</td><td>${escapeHtml(formatSats(i.amount_sats))}</td></tr>`,
      ),
      ...(decode.outputs || []).map(
        (o) =>
          `<tr><td>out</td><td>${escapeHtml(o.label || "")}</td><td class="mono">${escapeHtml(o.address)}</td><td>${escapeHtml(formatSats(o.amount_sats))}</td></tr>`,
      ),
    ].join("");
    if (io) {
      rows.push(`<div class="structured-decode">
        <table>
          <thead><tr><th></th><th>Label</th><th>Address</th><th>Amount</th></tr></thead>
          <tbody>${io}</tbody>
        </table>
      </div>`);
    }
  }
  const b64 = data.structured?.psbt_base64;
  if (b64) {
    rows.push(`<details class="structured-psbt">
      <summary>Unsigned PSBT (base64)</summary>
      <code class="mono structured-psbt-b64">${escapeHtml(b64)}</code>
      <p>${copyBtn(b64, "PSBT")}</p>
    </details>`);
  }
  if (data.structured?.settle_txid) {
    const tx = data.structured.settle_txid;
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Structured funding tx</span>
      <div class="onchain-value">
        <code class="mono">${escapeHtml(tx)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/tx/${tx}`, "Explorer")}
          ${copyBtn(tx, "txid")}
        </span>
      </div>
    </div>`);
  }
  return rows.join("");
}

/** Quiet meta line: created date, id, type, claim mode, and tags (status/byline live elsewhere). */
export function metaChipsHtml(p: Proposal): string {
  const bits: string[] = [];
  const created = timeAgoHtml(p.created_at);
  if (created) bits.push(created);
  if (p.id) {
    bits.push(`<span class="mono proposal-meta-id">${escapeHtml(p.id)}</span>`);
  }
  const type = String(p.proposal_type || "bounty").toLowerCase();
  bits.push(`<span class="proposal-meta-chip">${escapeHtml(type === "direct" ? "Campaign" : "Bounty")}</span>`);
  if (p.endowment_funded) {
    bits.push(
      `<a class="proposal-meta-chip proposal-meta-chip-endowment" href="${href("/endowment")}" title="Endowment">Endowment</a>`,
    );
  }
  // Live-updated from applications API in bindBuilderPanel.
  const claimChip = claimModeHeroChipHtml(p);
  if (claimChip) bits.push(claimChip);
  for (const tag of (p.tags || []).map((item) => item.trim()).filter(Boolean).slice(0, 12)) {
    bits.push(`<span class="proposal-meta-chip proposal-tag">${escapeHtml(tag)}</span>`);
  }
  if (!bits.length) return "";
  return `<div class="proposal-meta-line">${bits.join('<span class="proposal-meta-sep" aria-hidden="true">·</span>')}</div>`;
}

export function refundRegisterHtml(proposalId: string | null): string {
  if (!proposalId) return "";
  return `<div class="refund-panel" id="refund-panel">
    <h3 class="milestones-title">Register refund</h3>
    <p class="muted">Sign in, then set a refund address. Use your donation receipt.</p>
    <div id="refund-status" class="lifecycle-banner" hidden>
      <span class="lifecycle-k">Your contributions</span>
      <p id="refund-status-body" class="muted"></p>
      <ul id="refund-status-list" class="kh-verify-outputs"></ul>
    </div>
    <div id="refund-register-form">
      <fieldset class="field">
        <span>Rail</span>
        <label class="radio-row"><input type="radio" name="refund_rail" value="onchain" checked /> On-chain</label>
        <label class="radio-row"><input type="radio" name="refund_rail" value="lightning" /> Lightning</label>
      </fieldset>
      <div id="refund-onchain-fields">
        <label class="donate-amount-label" for="refund-txid">Funding txid</label>
        <input id="refund-txid" class="donate-amount mono" type="text" maxlength="64" />
        <label class="donate-amount-label" for="refund-vout">Vout</label>
        <input id="refund-vout" class="donate-amount mono" type="number" min="0" value="0" />
      </div>
      <div id="refund-ln-fields" hidden>
        <label class="donate-amount-label" for="refund-swap-id">Swap id</label>
        <input id="refund-swap-id" class="donate-amount mono" type="text" placeholder="From Lightning donate receipt" />
      </div>
      <label class="donate-amount-label" for="refund-address">Refund address</label>
      <input id="refund-address" class="donate-amount mono" type="text" placeholder="bc1… or tb1…" />
      <button type="button" class="btn" id="refund-submit">Register</button>
    </div>
    <p class="muted" id="refund-msg" hidden></p>
  </div>`;
}

export function ballotPanelHtml(proposalId: string | null): string {
  if (!proposalId) return "";
  return `<div class="ballot-panel" id="ballot-panel" data-proposal-id="${escapeHtml(proposalId)}">
    <h3 class="review-panel-title">Donor vote</h3>
    <p class="muted" id="ballot-status">Loading…</p>
    <div id="ballot-actions" class="review-actions" hidden>
      <button type="button" class="btn" data-ballot-opt="extend">Extend</button>
      <button type="button" class="btn ghost" data-ballot-opt="refund">Refund</button>
      <button type="button" class="btn ghost" data-ballot-opt="redirect">Move funds…</button>
    </div>
    <p class="muted" id="ballot-redirect-note">Moving remaining funds can take a few days.</p>
    <p class="builder-msg" id="ballot-msg" hidden></p>
  </div>`;
}

/** Deliverable link chip when present on the proposal record. */
export function deliverableChipHtml(url: string | null | undefined): string {
  if (!url?.startsWith("https://")) return "";
  return `<div class="deliverable-chip">
    <span class="lifecycle-k">Deliverable</span>
    <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url.replace(/^https:\/\//, ""))}</a>
  </div>`;
}

function formatMilestoneDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function milestoneDueHtml(iso: string, nowMs = Date.now()): string {
  const due = formatMilestoneDeadline(iso);
  const ahead = formatTimeAhead(iso, nowMs);
  const rel = ahead
    ? ` <span class="milestone-rail-due-rel">· ${escapeHtml(ahead.text)}</span>`
    : "";
  const title = ahead?.title || due;
  return `<time class="milestone-rail-due" datetime="${escapeHtml(iso)}" title="${escapeHtml(title)}">Due ${escapeHtml(due)}${rel}</time>`;
}

/** Created-by byline with profile link when a site username is present. */
export function proposerBylineHtml(
  proposer: Proposal["proposer"] | null | undefined,
  profileHref: (username: string) => string,
  opts?: {
    proposer_type?: string | null;
    orgHref?: (login: string) => string;
  },
): string {
  if (!proposer) return "";
  const isOrg = String(opts?.proposer_type || "").toLowerCase() === "org";
  const github = proposer.github?.trim();
  if (isOrg && github) {
    const hrefFn = opts?.orgHref;
    const link = hrefFn
      ? hrefFn(github)
      : `https://github.com/${encodeURIComponent(github)}`;
    return `<span class="proposal-byline">
      ${orgAvatarSlotHtml(github)}
      <span class="proposal-byline-label">by</span>
      <a class="proposal-byline-link" href="${escapeHtml(link)}">${escapeHtml(github)}</a>
    </span>`;
  }
  const username = proposer.username?.trim();
  if (username) {
    return `<span class="proposal-byline">
      ${avatarSlotHtml(username)}
      <span class="proposal-byline-label">by</span>
      <a class="proposal-byline-link" href="${profileHref(username)}">${escapeHtml(username)}</a>
    </span>`;
  }
  if (github) {
    return `<span class="proposal-byline">
      <span class="proposal-byline-label">by</span>
      <a class="proposal-byline-link" href="https://github.com/${escapeHtml(github)}" target="_blank" rel="noreferrer noopener">${escapeHtml(github)}</a>
    </span>`;
  }
  return "";
}

export function milestonesHtml(
  milestones: ProposalMilestone[],
  nowMs = Date.now(),
): string {
  if (!milestones.length) return "";
  const total = milestones.reduce(
    (s, m) => s + (Number(m.allocation_sats) || 0),
    0,
  );
  return `<section class="proposal-milestones" aria-labelledby="milestones-heading">
    <header class="proposal-milestones-head">
      <h2 id="milestones-heading" class="proposal-block-title">Milestones</h2>
      <p class="proposal-block-lede">${escapeHtml(formatSats(total))} allocated across ${milestones.length} stage${milestones.length === 1 ? "" : "s"}</p>
    </header>
    <ol class="milestone-rail">
      ${milestones
        .map((m, i) => {
          const due = m.deadline
            ? milestoneDueHtml(String(m.deadline), nowMs)
            : "";
          const moreBits: string[] = [];
          if (m.verification) {
            moreBits.push(
              `<p class="milestone-rail-verify"><span class="milestone-rail-k">Verify</span> ${linkifyText(m.verification)}</p>`,
            );
          }
          if (m.out_of_scope) {
            moreBits.push(
              `<p class="milestone-rail-oos"><span class="milestone-rail-k">Out of scope</span> ${linkifyText(m.out_of_scope)}</p>`,
            );
          }
          if (m.dependencies?.length) {
            moreBits.push(
              `<p class="milestone-rail-deps"><span class="milestone-rail-k">Depends on</span> ${linkifyText(m.dependencies.join(", "))}</p>`,
            );
          }
          return `<li class="milestone-rail-item">
          <div class="milestone-rail-marker" aria-hidden="true">${i + 1}</div>
          <div class="milestone-rail-body">
            <div class="milestone-rail-meta">
              <span class="milestone-rail-sats sats">${escapeHtml(formatSats(m.allocation_sats))}</span>
              ${due}
            </div>
            <p class="milestone-rail-deliverable">${linkifyText(m.deliverable)}</p>
            ${
              moreBits.length
                ? `<details class="milestone-more"><summary>Details</summary>${moreBits.join("")}</details>`
                : ""
            }
          </div>
        </li>`;
        })
        .join("")}
    </ol>
  </section>`;
}

function dependsOnItemsHtml(
  items: { kind: string; label: string; ref?: string; note?: string }[],
): string {
  return `<ul class="dep-list">${items
    .map((d) => {
      const kind = d.kind === "external" ? "external" : "plebly";
      let ref = "";
      if (d.ref) {
        if (/^https?:\/\//i.test(d.ref)) {
          ref = `<a href="${escapeHtml(d.ref)}" target="_blank" rel="noreferrer noopener">${escapeHtml(d.ref)}</a>`;
        } else if (kind === "plebly") {
          const path = pleblyDepHref(d.ref);
          ref = path
            ? `<a class="mono" href="${proposalHref(path)}">${escapeHtml(d.ref)}</a>`
            : `<span class="mono">${escapeHtml(d.ref)}</span>`;
        } else {
          ref = `<span class="mono">${linkifyText(d.ref)}</span>`;
        }
      }
      return `<li class="dep-list-item">
        <div class="dep-list-head">
          <span class="pill">${escapeHtml(depKindLabel(kind))}</span>
          <strong>${linkifyText(d.label)}</strong>
        </div>
        ${ref ? `<p class="dep-list-ref">${ref}</p>` : ""}
        ${d.note ? `<p class="dep-list-note">${linkifyText(d.note)}</p>` : ""}
      </li>`;
    })
    .join("")}</ul>`;
}

function relatedWorkItemsHtml(
  items: { label: string; url: string; note?: string }[],
): string {
  return `<ul class="dep-list">${items
    .map((d) => {
      const labelMatchesUrl =
        d.label.trim().toLowerCase() === d.url.trim().toLowerCase();
      const href = (() => {
        try {
          const u = new URL(d.url.trim());
          if (u.protocol !== "http:" && u.protocol !== "https:") return null;
          return escapeHtml(d.url.trim());
        } catch {
          return null;
        }
      })();
      if (!href) {
        return `<li class="dep-list-item"><div class="dep-list-head"><strong>${escapeHtml(d.label)}</strong></div></li>`;
      }
      return `<li class="dep-list-item">
        <div class="dep-list-head">
          <a href="${href}" target="_blank" rel="noreferrer noopener"><strong>${escapeHtml(d.label)}</strong></a>
        </div>
        ${
          labelMatchesUrl
            ? ""
            : `<p class="dep-list-ref muted mono"><a href="${href}" target="_blank" rel="noreferrer noopener">${href}</a></p>`
        }
        ${d.note ? `<p class="dep-list-note">${linkifyText(d.note)}</p>` : ""}
      </li>`;
    })
    .join("")}</ul>`;
}

export function dependsOnHtml(
  items: { kind: string; label: string; ref?: string; note?: string }[],
): string {
  if (!items?.length) return "";
  return `<section class="proposal-deps" aria-labelledby="depends-on-heading">
    <h2 id="depends-on-heading" class="proposal-block-title">Depends on</h2>
    <p class="proposal-block-lede">Blocking work this project needs first</p>
    ${dependsOnItemsHtml(items)}
  </section>`;
}

export function relatedWorkHtml(
  items: { label: string; url: string; note?: string }[],
): string {
  if (!items?.length) return "";
  return `<section class="proposal-deps" aria-labelledby="related-work-heading">
    <h2 id="related-work-heading" class="proposal-block-title">Related work</h2>
    <p class="proposal-block-lede">Prior art and external context</p>
    ${relatedWorkItemsHtml(items)}
  </section>`;
}

/** Combined context band: blocking deps + related work, one section. */
export function proposalContextHtml(
  dependsOn: { kind: string; label: string; ref?: string; note?: string }[],
  relatedWork: { label: string; url: string; note?: string }[],
): string {
  if (!dependsOn?.length && !relatedWork?.length) return "";
  return `<section class="proposal-context" aria-labelledby="context-heading">
    <h2 id="context-heading" class="proposal-block-title">Context</h2>
    ${
      dependsOn.length
        ? `<div class="proposal-context-group">
      <h3 class="proposal-context-sub">Depends on</h3>
      <p class="proposal-block-lede">Blocking work this project needs first</p>
      ${dependsOnItemsHtml(dependsOn)}
    </div>`
        : ""
    }
    ${
      relatedWork.length
        ? `<div class="proposal-context-group">
      <h3 class="proposal-context-sub">Related work</h3>
      <p class="proposal-block-lede">Prior art and external context</p>
      ${relatedWorkItemsHtml(relatedWork)}
    </div>`
        : ""
    }
  </section>`;
}

export function userMatchesProposer(
  user: {
    id?: string;
    username?: string;
    github?: string;
    x?: string;
    nostr?: string;
    github_orgs?: GithubOrgAttestation[];
  } | null,
  proposer: {
    username?: string | null;
    github?: string | null;
    x?: string | null;
    nostr?: string | null;
    agent?: string | null;
    id?: string | null;
  } | null | undefined,
  proposerType?: string | null,
): boolean {
  if (!user || !proposer) return false;
  const norm = (v: unknown) =>
    String(v || "")
      .toLowerCase()
      .replace(/^@/, "")
      .trim();
  const proposerId = String(proposer.id || "").trim();
  if (proposerId && user.id && proposerId === user.id) return true;

  if (String(proposerType || "").toLowerCase() === "org") {
    const orgLogin = norm(proposer.github);
    if (!orgLogin) return false;
    return isFreshLinkedOrgAdmin(user, orgLogin);
  }

  const pairs: [string, string][] = [
    [norm(user.username), norm(proposer.username)],
    [norm(user.github), norm(proposer.github)],
    [norm(user.x), norm(proposer.x)],
    [norm(user.nostr), norm(proposer.nostr)],
  ];
  return pairs.some(([a, b]) => Boolean(a && b && a === b));
}

export function canEditProposal(
  user: {
    id?: string;
    username?: string;
    github?: string;
    x?: string;
    nostr?: string;
    github_orgs?: GithubOrgAttestation[];
  } | null,
  proposer: {
    username?: string | null;
    github?: string | null;
    x?: string | null;
    nostr?: string | null;
    agent?: string | null;
    id?: string | null;
  } | null | undefined,
  status: string,
  proposerType?: string | null,
): boolean {
  if (!EDITABLE_PROPOSAL_STATUSES.has(status)) return false;
  return userMatchesProposer(user, proposer, proposerType);
}

function verificationStepsHtml(body: string): string | null {
  const items = body
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, "").trim());
  if (items.length < 2) return null;
  return `<ol class="verify-steps">${items
    .map((item) => `<li>${linkifyText(item)}</li>`)
    .join("")}</ol>`;
}

export function sectionBodyHtml(title: string, body: string, renderMd: (s: string) => string): string {
  const key = title.toLowerCase();
  if (key === "verification") {
    const steps = verificationStepsHtml(body);
    if (steps) return steps;
  }
  return `<div class="prose-rich">${renderMd(body)}</div>`;
}

export function bindProposalCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.dataset.copy;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        /* ignore */
      }
    });
  });
}
