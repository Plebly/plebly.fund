import { escapeHtml } from "./util";

/**
 * Short reason shown where Donate and the escrow address used to be when the
 * claim view says `accepting_funds === false` (workers#51 sends that for every
 * row whose status is not FUNDABLE). Plain text, not a live region.
 */
export const DONATE_CLOSED_BUILDING = "Funding is closed while this is being built.";
export const DONATE_CLOSED_REFUNDING = "Refunds in progress.";
export const DONATE_CLOSED_OTHER = "This listing isn't accepting funds.";

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
  if (
    state === "claimed" ||
    state === "in_review" ||
    status === "claimed" ||
    status === "in_review"
  ) {
    return DONATE_CLOSED_BUILDING;
  }
  if (status === "refunding") return DONATE_CLOSED_REFUNDING;
  return DONATE_CLOSED_OTHER;
}

/** Muted note for the Donate slot (same styling as the slot's loading/error notes). */
export function donateClosedNoteHtml(reason: string): string {
  return `<p class="muted donate-closed-note" id="donate-closed-note">${escapeHtml(reason)}</p>`;
}

/** Muted note that takes the escrow address row's place in the on-chain panel. */
export function escrowClosedNoteHtml(reason: string): string {
  return `<p class="muted donate-closed-note" id="onchain-escrow-closed-note">${escapeHtml(reason)}</p>`;
}
