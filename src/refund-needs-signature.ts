/**
 * Refund panel lines that send the donor to "Refund by signing a message"
 * (the `#signed-refund` disclosure under the panel):
 * - `/refunds/register` answered `code: "refund_requires_signature"`;
 * - a `/refunds/status` row carries `refund_needs_signature: true`.
 * Copy is fixed client text; server text never reaches the page.
 */
import { escapeHtml } from "./util";

/** Anchor of the signed-refund disclosure (fund#100). */
export const SIGNED_REFUND_ANCHOR = "signed-refund";

/** Worker code on /refunds/register when this gift needs the signature route. */
export const REFUND_REQUIRES_SIGNATURE = "refund_requires_signature";

const LINK_TEXT = "Refund by signing a message";

export const REFUND_SIGNATURE_COPY = {
  registerNeedsSignature: `Refunds for this gift need a signed message. Use "${LINK_TEXT}" below.`,
  rowNeedsSignature: `This refund address needs a signed message before it can be paid. Use "${LINK_TEXT}" below.`,
} as const;

/** The line as HTML, with the quoted name linking to the disclosure. */
export function signatureLineHtml(line: string): string {
  const quoted = `"${LINK_TEXT}"`;
  const at = line.indexOf(quoted);
  if (at < 0) return escapeHtml(line);
  return `${escapeHtml(line.slice(0, at))}"<a href="#${SIGNED_REFUND_ANCHOR}" data-open-signed-refund>${escapeHtml(
    LINK_TEXT,
  )}</a>"${escapeHtml(line.slice(at + quoted.length))}`;
}

/** Open the signed-refund disclosure (when present) and bring it into view. */
export function openSignedRefund(doc: ParentNode = document): boolean {
  const el = doc.querySelector<HTMLElement>(`#${SIGNED_REFUND_ANCHOR}`);
  if (!el) return false;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView?.({ block: "nearest" });
  return true;
}

/** A status row the payout gate skips until it's re-bound by signature. */
export function rowNeedsSignature(row: { refund_needs_signature?: unknown }): boolean {
  return row.refund_needs_signature === true;
}
