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
  return DONATE_CLOSED_OTHER;
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
