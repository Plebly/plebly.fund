import { escapeHtml, formatSats } from "./util";

/**
 * Shared-escrow donate remainder as the Worker reports it
 * (`donate_remainder_owed` on the structured-funding view).
 */
export type DonateRemainderOwed = {
  owed_sats?: number;
  covered_sats?: number;
  outstanding_sats?: number;
  sent_sats?: number;
  settled?: boolean;
  settle_txid?: string;
};

/**
 * A positive whole number of sats (floored), or null. Zero, negatives, null,
 * strings, NaN and Infinity are all null: nothing is coerced, and 0 reads the
 * same as a missing value.
 */
function positiveSats(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n > 0 ? n : null;
}

/** Pill label when something was sent and some is still owed. */
export const PARTLY_REFUNDED_LABEL = "Partly refunded";
/** Pill label when nothing is known to have been sent (0, missing or invalid sent_sats). */
export const REFUND_OWED_LABEL = "Refund owed";

type PartialRefund = { label: string; copy: string };

/**
 * The settled-remainder note and its pill label, or null. Only for a settled
 * remainder that still owes something; a missing or malformed outstanding
 * amount shows nothing (no note, no pill).
 *
 * The sent amount is `sent_sats` only (never covered_sats). A positive one
 * gives "Partly refunded". 0, missing or invalid gives "Refund owed" on
 * purpose: before workers#109 deploys a missing field can still mean nothing
 * was sent. Until the pool top-up is live the copy promises nothing more will
 * be sent; it only says the amount owed is on record.
 */
function partialRefund(owed: DonateRemainderOwed | null | undefined): PartialRefund | null {
  if (!owed || owed.settled !== true) return null;
  const outstanding = positiveSats(owed.outstanding_sats);
  if (outstanding == null) return null;
  const sent = positiveSats(owed.sent_sats);
  if (sent == null) {
    return {
      label: REFUND_OWED_LABEL,
      copy: `${formatSats(outstanding)} still owed. The amount owed is on record.`,
    };
  }
  return {
    label: PARTLY_REFUNDED_LABEL,
    copy: `Partly refunded: ${formatSats(sent)} sent, ${formatSats(outstanding)} still owed. The amount still owed is on record.`,
  };
}

/** The note's sentence, or null when no note shows. */
export function partialRefundCopy(owed: DonateRemainderOwed | null | undefined): string | null {
  return partialRefund(owed)?.copy ?? null;
}

/** Status pill label: the note's label whenever the note shows, else the server status. */
export function refundStatusLabel(
  status: string,
  owed: DonateRemainderOwed | null | undefined,
  noteShown = true,
): string {
  const partial = noteShown ? partialRefund(owed) : null;
  return partial ? partial.label : status;
}

export function partialRefundHtml(owed: DonateRemainderOwed | null | undefined): string {
  const copy = partialRefundCopy(owed);
  return copy ? `<p class="muted partial-refund-note" role="note">${escapeHtml(copy)}</p>` : "";
}
