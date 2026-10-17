import { isFundableStatus } from "./config";
import { escapeHtml } from "./util";

/**
 * Short reason shown where Donate and the escrow address used to be when the
 * claim view says `accepting_funds === false` (workers#51 sends that for every
 * row whose status is not FUNDABLE). Plain text, not a live region.
 */
/** in_review, claimed, completed, bounty_settled, settled (UI UX copy). */
export const DONATE_CLOSED_COMPLETE = "Funding for this proposal is complete.";
/** declined, rejected, voided, refunding, and any other non-fundable status. */
export const DONATE_CLOSED_OTHER = "This proposal is closed and isn't accepting gifts.";
/**
 * Status still fundable but funds closed for now (e.g. the funding PSBT is
 * built). Also used by the Donate modal's paused state (proposal-ui).
 */
export const DONATE_PAUSED_LINE = "Donations are paused for this proposal right now.";

/**
 * Settled beats voided (workers catalogStructuredFields checks settled first;
 * the claim view's `settled` state / catalog `bounty_settled` status come from
 * isBountySettled). Claim state `settled`, status `bounty_settled` or `settled`.
 */
const SETTLED = new Set(["bounty_settled", "settled"]);
/** Complete group once nothing says voided / closed. */
const FUNDING_COMPLETE = new Set(["in_review", "claimed", "completed"]);
/** Statuses that close funds outright, checked before the complete group. */
const CLOSED_STATUSES = new Set(["declined", "rejected", "refunding"]);
/**
 * Claim-view states a still-fundable row can be in while funds are paused.
 * `unavailable` covers the unreadable-record case. Anything else (unknown,
 * or a non-open state) reads closed.
 */
const PAUSABLE_CLAIM_STATES = new Set(["", "open", "below_floor", "claim_pending", "unavailable"]);

/**
 * Structured states that can clear on their own: workers reports
 * "unreadable" when the funding record's KV read or parse fails (fail closed,
 * 503), and the next successful read restores it. Voided is final.
 */
const TEMPORARY_STRUCTURED = new Set(["unreadable"]);

type ClosedClaim = {
  accepting_funds?: boolean | null;
  state?: string | null;
  status?: string | null;
  psbt?: { structured_state?: string | null } | null;
};

/**
 * Reason copy for a funds-closed claim view; null when funds are not closed.
 * `catalogStructuredState` is the catalog row's structured_state: the catalog
 * marks an unreadable record `status: voided` + `structured_state: unreadable`,
 * which is temporary, not a real void.
 */
export function donateClosedReason(
  proposalStatus: string | null | undefined,
  claim: ClosedClaim | null | undefined,
  catalogStructuredState?: string | null,
): string | null {
  if (!claim || claim.accepting_funds !== false) return null;
  const state = String(claim.state || "").toLowerCase();
  const claimStatus = String(claim.status || "").toLowerCase();
  const catalogStatus = String(proposalStatus || "").toLowerCase();
  const status = claimStatus || catalogStatus;
  const catalogStructured = String(catalogStructuredState || "").toLowerCase();
  const claimStructured = String(claim.psbt?.structured_state || "").toLowerCase();
  const catalogTemporary = TEMPORARY_STRUCTURED.has(catalogStructured);

  // 1. Settled wins over everything, voided included (workers: settled first).
  if (state === "settled" || SETTLED.has(claimStatus) || SETTLED.has(catalogStatus)) {
    return DONATE_CLOSED_COMPLETE;
  }
  // 2. Any source that says voided closes it, except the catalog's
  //    fail-closed stand-in for an unreadable record (status voided +
  //    structured_state unreadable), which is temporary.
  const voided =
    state === "voided" ||
    claimStatus === "voided" ||
    claimStructured === "voided" ||
    catalogStructured === "voided" ||
    (catalogStatus === "voided" && !catalogTemporary);
  // 3. Declined / rejected / refunding close it, even with a claimer.
  if (voided || CLOSED_STATUSES.has(catalogStatus) || CLOSED_STATUSES.has(claimStatus)) {
    return DONATE_CLOSED_OTHER;
  }
  // 4. Complete group.
  if (FUNDING_COMPLETE.has(state) || FUNDING_COMPLETE.has(status)) {
    return DONATE_CLOSED_COMPLETE;
  }
  // 5. Paused only when every source still says fundable and the claim state
  //    is a known open one. A missing catalog status is not fundable here.
  //    A claim STATUS of `unavailable` (workers builder-claim: the claim record
  //    could not be read) is temporary, so it defers to the catalog: paused
  //    only when the catalog status is fundable. Status only, never state; the
  //    settled, voided/closed and complete checks above have already run.
  const catalogFundable =
    isFundableStatus(catalogStatus) || (catalogStatus === "voided" && catalogTemporary);
  const claimUnavailable = claimStatus === "unavailable";
  const statusFundable = isFundableStatus(status) || claimUnavailable;
  if (statusFundable && catalogFundable && PAUSABLE_CLAIM_STATES.has(state)) {
    return DONATE_PAUSED_LINE;
  }
  return DONATE_CLOSED_OTHER;
}

/**
 * Closed-funds copy for a row already known to be closed (the next card uses
 * this so it never shows a second wording next to the Donate-slot note).
 */
export function closedFundsCopy(
  proposalStatus: string | null | undefined,
  claim?: Omit<ClosedClaim, "accepting_funds"> | null,
  catalogStructuredState?: string | null,
): string {
  return donateClosedReason(
    proposalStatus,
    { ...(claim || {}), accepting_funds: false },
    catalogStructuredState,
  )!;
}

/**
 * Reason note for the Donate slot. Uses `.donate-closed-note` (`--ink-secondary`),
 * not `.muted`: it is the only explanation a donor gets when Donate disappears,
 * and `--muted` is below AA 4.5:1 on the page and card backgrounds.
 */
export function donateClosedNoteHtml(reason: string): string {
  return `<p class="donate-closed-note" id="donate-closed-note">${escapeHtml(reason)}</p>`;
}

/** Reason note (same `.donate-closed-note` styling) in the escrow address row's place. */
export function escrowClosedNoteHtml(reason: string): string {
  return `<p class="donate-closed-note" id="onchain-escrow-closed-note">${escapeHtml(reason)}</p>`;
}
