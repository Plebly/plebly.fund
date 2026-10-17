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

function sats(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * "Partly refunded" copy, or null. Only for a settled remainder that still
 * owes something; anything missing or malformed shows nothing.
 */
export function partialRefundCopy(owed: DonateRemainderOwed | null | undefined): string | null {
  if (!owed || owed.settled !== true) return null;
  const outstanding = sats(owed.outstanding_sats);
  if (outstanding == null || outstanding <= 0) return null;
  const sent = sats(owed.sent_sats) ?? sats(owed.covered_sats);
  if (sent == null) return null;
  return `Partly refunded: ${formatSats(sent)} sent, ${formatSats(outstanding)} still owed. The rest will be refunded when more escrow funds are available.`;
}

export function partialRefundHtml(owed: DonateRemainderOwed | null | undefined): string {
  const copy = partialRefundCopy(owed);
  return copy ? `<p class="muted partial-refund-note" role="note">${escapeHtml(copy)}</p>` : "";
}
