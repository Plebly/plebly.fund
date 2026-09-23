/**
 * Client-side payout destination checks (bond refund + claim payout).
 * Mirrors workers/src/lib/payout-destination.ts — server remains authoritative.
 */
import { addressHrp, lightningUiAllowed, networkLabel } from "./config";

export type PayoutRail = "onchain" | "lightning";

export const BOUNTY_ONCHAIN_PAYOUT_ERROR =
  "Bounty payouts must be an on-chain address (bc1…/tb1…). Lightning Address and LNURL cannot be baked into a presigned PSBT. Use a Direct campaign if you need Lightning payout.";

export function isLightningPayoutDestination(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^lnurl1[ac-hj-np-z02-9]+$/i.test(s)) return true;
  return /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
    s,
  );
}

export function payoutLooksValid(raw: string, rail?: PayoutRail): boolean {
  const s = raw.trim();
  if (!s) return false;
  const preferLn =
    rail === "lightning" || (!rail && isLightningPayoutDestination(s));
  if (preferLn) {
    if (!lightningUiAllowed()) return false;
    return isLightningPayoutDestination(s);
  }
  const hrp = addressHrp();
  return new RegExp(`^${hrp}[a-z0-9]{20,90}$`, "i").test(s);
}

/** Network-aware placeholder for Account receive / refund+claim payout. */
export function accountPayoutPlaceholder(): string {
  const hrp = addressHrp();
  if (lightningUiAllowed()) return `${hrp}… or you@host`;
  return `${hrp}…`;
}

/** Short hint under the Account payout field. */
export function accountPayoutHint(): string {
  const net = networkLabel();
  const hrp = addressHrp();
  if (lightningUiAllowed()) {
    return `Refund + claim payout destination on ${net}: on-chain ${hrp}… or Lightning Address.`;
  }
  return `Refund + claim payout destination on ${net}: on-chain bech32 starting with ${hrp}… (Lightning not allowed here).`;
}

/** Status when no receive address is stored (after clear or never set). */
export function accountPayoutMissingMessage(): string {
  const net = networkLabel();
  const hrp = addressHrp();
  return `${net[0]!.toUpperCase()}${net.slice(1)} receive address is not set yet — add a ${hrp}… address for refunds and claim payouts.`;
}

/**
 * Plain fail-closed reason when a non-empty value is invalid.
 * Distinguishes wrong network / Lightning-not-allowed / garbage from "missing".
 */
export function payoutInvalidReason(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (payoutLooksValid(s)) return null;

  const net = networkLabel();
  const hrp = addressHrp();
  const wantMainnet = hrp === "bc1";

  if (isLightningPayoutDestination(s)) {
    if (!lightningUiAllowed()) {
      return `Lightning Address isn’t allowed on ${net} — use a ${net} receive address starting with ${hrp}….`;
    }
    return "That Lightning Address or LNURL looks invalid.";
  }

  const lower = s.toLowerCase();
  if (wantMainnet && /^tb1[a-z0-9]+$/i.test(lower)) {
    return `That address is for signet/testnet, not ${net}. Use a mainnet receive address starting with bc1….`;
  }
  if (!wantMainnet && /^bc1[a-z0-9]+$/i.test(lower)) {
    return `That address is for mainnet, not ${net}. Use a ${net} receive address starting with ${hrp}….`;
  }
  if (/^(bc1|tb1)[a-z0-9]+$/i.test(lower)) {
    return `Invalid ${net} bech32 receive address (${hrp}…).`;
  }
  return `Invalid receive address. On ${net} use a ${hrp}… bech32 address${
    lightningUiAllowed() ? " or Lightning Address (user@host)" : ""
  }.`;
}

export type AccountPayoutSaveGate =
  | { ok: true; mode: "set"; payout_address: string }
  | { ok: true; mode: "omit" }
  | { ok: true; mode: "clear" }
  | {
      ok: false;
      kind: "invalid" | "needs_explicit_clear";
      message: string;
    };

/**
 * Gate Account profile saves for payout_address.
 * - Empty + prior set → fail closed (no silent clear / no silent keep-as-is).
 * - Empty + never set → omit field (other profile fields may still save).
 * - Non-empty invalid → fail closed with invalid (not missing) copy.
 * - allowClear after Confirm / Clear button → intentional clear.
 */
export function gateAccountPayoutSave(opts: {
  raw: string;
  previous: string | null | undefined;
  allowClear?: boolean;
}): AccountPayoutSaveGate {
  const trimmed = opts.raw.trim();
  const previous = (opts.previous || "").trim();

  if (!trimmed) {
    if (!previous) return { ok: true, mode: "omit" };
    if (opts.allowClear) return { ok: true, mode: "clear" };
    return {
      ok: false,
      kind: "needs_explicit_clear",
      message:
        "Receive address would be cleared. Use Clear receive address to remove it, or put the address back before Save.",
    };
  }

  const invalid = payoutInvalidReason(trimmed);
  if (invalid) {
    return { ok: false, kind: "invalid", message: invalid };
  }
  return { ok: true, mode: "set", payout_address: trimmed };
}
