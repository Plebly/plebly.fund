import { isFundableStatus } from "./config";
import { escapeHtml } from "./util";

/**
 * Short reason shown where Donate and the escrow address used to be when the
 * claim view says `accepting_funds === false` (workers#51 sends that for every
 * row whose status is not FUNDABLE). Plain text, not a live region.
 */
/** in_review, claimed, completed, bounty_settled (UI UX copy). */
export const DONATE_CLOSED_COMPLETE = "Funding for this proposal is complete.";
/** declined, rejected, voided, refunding, and any other non-fundable status. */
export const DONATE_CLOSED_OTHER = "This proposal is closed and isn't accepting gifts.";
/**
 * Status still fundable but funds closed for now (e.g. the funding PSBT is
 * built). Also used by the Donate modal's paused state (proposal-ui).
 */
export const DONATE_PAUSED_LINE = "Donations are paused for this proposal right now.";

const FUNDING_COMPLETE = new Set(["in_review", "claimed", "completed", "bounty_settled", "settled"]);

/** Reason copy for a funds-closed claim view; null when funds are not closed. */
export function donateClosedReason(
  proposalStatus: string | null | undefined,
  claim: {
    accepting_funds?: boolean | null;
    state?: string | null;
    status?: string | null;
  } | null | undefined,
): string | null {
  if (!claim || claim.accepting_funds !== false) return null;
  const state = String(claim.state || "").toLowerCase();
  const status = String(claim.status || proposalStatus || "").toLowerCase();
  if (FUNDING_COMPLETE.has(state) || FUNDING_COMPLETE.has(status)) {
    return DONATE_CLOSED_COMPLETE;
  }
  // Paused only when every source still says fundable: a catalog declined or
  // voided row stays closed even if the claim view still says listed.
  const catalogStatus = String(proposalStatus || "").toLowerCase();
  const fundable =
    state !== "voided" &&
    isFundableStatus(status) &&
    (!catalogStatus || isFundableStatus(catalogStatus));
  if (fundable) return DONATE_PAUSED_LINE;
  return DONATE_CLOSED_OTHER;
}

/**
 * Closed-funds copy for a row already known to be closed (the next card uses
 * this so it never shows a second wording next to the Donate-slot note).
 */
export function closedFundsCopy(
  proposalStatus: string | null | undefined,
  claim?: { state?: string | null; status?: string | null } | null,
): string {
  return donateClosedReason(proposalStatus, { ...(claim || {}), accepting_funds: false })!;
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
