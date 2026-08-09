/**
 * Client-side payout destination checks (bond refund + claim payout).
 * Mirrors workers/src/lib/payout-destination.ts — server remains authoritative.
 */
import { addressHrp, lightningUiAllowed } from "./config";

export type PayoutRail = "onchain" | "lightning";

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
  const preferLn = rail === "lightning" || (!rail && isLightningPayoutDestination(s));
  if (preferLn) {
    if (!lightningUiAllowed()) return false;
    return isLightningPayoutDestination(s);
  }
  const hrp = addressHrp();
  return new RegExp(`^${hrp}[a-z0-9]{20,90}$`, "i").test(s);
}
