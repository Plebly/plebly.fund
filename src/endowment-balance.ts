import { endowmentMeterHtml } from "./proposal-ui";
import { escapeHtml, formatSats } from "./util";

/** Shown instead of any amount or Give button while the endowment has no address of its own. */
export const ENDOWMENT_SHARED_LINE =
  "Endowment balance will show once it has its own address.";
export const ENDOWMENT_BALANCE_LABEL = "Balance";
export const ENDOWMENT_TOTAL_GIVEN_LABEL = "Total given to date";
export const ENDOWMENT_BALANCE_UNAVAILABLE = "Balance temporarily unavailable.";

/**
 * What the endowment panel may show.
 * - shared: no amounts, no meter, no Give. Used when the API says the address
 *   is shared with a proposal escrow, when the give address is unusable or
 *   null, AND when balance_shared_with_escrow is missing (older API: unknown,
 *   so never trust display_balance_sats).
 * - own: the endowment has its own address; balance from a live UTXO read.
 */
export type EndowmentBalanceView =
  | { kind: "shared" }
  | {
      kind: "own";
      address: string;
      balance_sats: number | null;
      total_given_sats: number | null;
      goal_sats: number;
    };

function satsOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

export function endowmentBalanceView(body: unknown): EndowmentBalanceView {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const address = typeof b.address === "string" ? b.address.trim() : "";
  if (b.balance_shared_with_escrow !== false) return { kind: "shared" };
  if (b.give_address_usable === false) return { kind: "shared" };
  if (!address) return { kind: "shared" };
  return {
    kind: "own",
    address,
    balance_sats: b.balance_unavailable === true ? null : satsOrNull(b.balance_sats),
    total_given_sats: satsOrNull(b.total_given_sats),
    goal_sats: satsOrNull(b.goal_sats) ?? 0,
  };
}

/** True only when the Give/Donate button and modal may be shown. */
export function endowmentGiveAllowed(view: EndowmentBalanceView): boolean {
  return view.kind === "own";
}

/** Amounts block: the shared line, or Balance + Total given to date. */
export function endowmentFiguresHtml(
  view: EndowmentBalanceView,
  opts?: { size?: "card" | "hero" },
): string {
  if (view.kind !== "own") {
    return `<p class="endowment-shared-note">${escapeHtml(ENDOWMENT_SHARED_LINE)}</p>`;
  }
  const balance =
    view.balance_sats == null
      ? `<p class="endowment-balance-unavailable muted">${escapeHtml(ENDOWMENT_BALANCE_UNAVAILABLE)}</p>`
      : endowmentMeterHtml(view.balance_sats, view.goal_sats, opts);
  const total =
    view.total_given_sats == null
      ? ""
      : `<div class="endowment-figure endowment-figure-total">
        <p class="endowment-figure-label">${escapeHtml(ENDOWMENT_TOTAL_GIVEN_LABEL)}</p>
        <p class="endowment-figure-value mono">${escapeHtml(formatSats(view.total_given_sats))}</p>
      </div>`;
  return `<div class="endowment-figures">
    <div class="endowment-figure endowment-figure-balance">
      <p class="endowment-figure-label">${escapeHtml(ENDOWMENT_BALANCE_LABEL)}</p>
      ${balance}
    </div>
    ${total}
  </div>`;
}
