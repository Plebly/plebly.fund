import {
  CLAIM_FLOOR_SATS as GENERATED_CLAIM_FLOOR_SATS,
  PLEBLY_PARAMETERS_NETWORK as GENERATED_PARAMETERS_NETWORK,
} from "./generated/parameters";

export const PROPOSALS_REPO = "Plebly/proposals";
export const PROPOSALS_RAW = `https://raw.githubusercontent.com/${PROPOSALS_REPO}/main`;
export const PROPOSALS_API = `https://api.github.com/repos/${PROPOSALS_REPO}/contents/proposals`;

/** Cloudflare Workers API */
export const WORKERS_API =
  import.meta.env.VITE_WORKERS_API ||
  "https://plebly-api.securesovereigns.workers.dev";

/** signet while testing; mainnet at launch */
export const BITCOIN_NETWORK =
  import.meta.env.VITE_BITCOIN_NETWORK || "signet";

/**
 * Show Lightning donate UI when mainnet/testnet.
 * Signet stays on-chain only (Boltz has no signet pair).
 * `VITE_LIGHTNING_TESTNET=1` / `VITE_LIGHTNING=1` are for testnet staging builds only.
 */
export function lightningUiAllowed(): boolean {
  const n = BITCOIN_NETWORK.toLowerCase();
  if (n === "signet") return false;
  if (
    import.meta.env.VITE_LIGHTNING_TESTNET === "1" ||
    import.meta.env.VITE_LIGHTNING === "1"
  ) {
    return true;
  }
  return n === "mainnet" || n === "bitcoin" || n === "testnet";
}

export const MEMPOOL_API = (() => {
  const n = BITCOIN_NETWORK.toLowerCase();
  if (n === "signet") return "https://mempool.space/signet/api";
  if (n === "testnet") return "https://mempool.space/testnet/api";
  return "https://mempool.space/api";
})();

/** Bech32 HRP for donate / payout addresses on this build. */
export function addressHrp(network: string = BITCOIN_NETWORK): "tb1" | "bc1" {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "bitcoin") return "bc1";
  return "tb1";
}

/** Human network label for UI copy. */
export function networkLabel(network: string = BITCOIN_NETWORK): string {
  const n = network.toLowerCase();
  if (n === "signet") return "signet";
  if (n === "testnet") return "testnet";
  return "mainnet";
}

/** Mempool.space web base (not API) for this build. */
export function mempoolWeb(network: string = BITCOIN_NETWORK): string {
  const n = network.toLowerCase();
  if (n === "signet") return "https://mempool.space/signet";
  if (n === "testnet") return "https://mempool.space/testnet";
  return "https://mempool.space";
}

export function escrowAddressMatchesNetwork(
  address: string,
  network: string = BITCOIN_NETWORK,
): boolean {
  const hrp = addressHrp(network);
  return new RegExp(`^${hrp}[a-z0-9]{20,90}$`, "i").test(address.trim());
}

/** Statuses that may solicit donations (must match workers proposal-escrow). */
export const FUNDABLE_STATUSES = new Set([
  "listed",
  "funding",
  "claimable",
  "declined_fundable",
]);

export function isFundableStatus(status: string): boolean {
  return FUNDABLE_STATUSES.has(String(status || "").trim());
}

export {
  CLAIM_FLOOR_SATS,
  CLAIM_BOND_SATS,
  CLAIM_CHECKPOINT_DAY,
  CLAIM_CHECKPOINT_GRACE_DAYS,
  CLAIM_PENDING_TTL_HOURS,
  CORE_ANNUAL_GAP_SATS,
  CLAIM_ABUSE_ESCALATION_THRESHOLD,
  IDENTITY_RELINK_COOLDOWN_DAYS,
  MAX_ACTIVE_CLAIMS,
  MAX_SITE_CLAIM_PRS_PER_DAY,
  MILESTONE_THRESHOLD_SATS,
  PLATFORM_FEE_PERCENT,
  RECLAIM_COOLDOWN_DAYS,
  SUBMISSION_FEE_SATS,
  PLEBLY_PARAMETERS_NETWORK,
} from "./generated/parameters";

/** Build-time network for parameters.json must match VITE_BITCOIN_NETWORK. */
export function expectedParametersNetwork(
  bitcoinNetwork: string = BITCOIN_NETWORK,
): "signet" | "mainnet" {
  const n = bitcoinNetwork.toLowerCase();
  // testnet staging shares the signet parameter overlay (tb1 / signet floors).
  if (n === "mainnet" || n === "bitcoin") return "mainnet";
  return "signet";
}

/**
 * Fail closed when generated parameters.json network disagrees with
 * VITE_BITCOIN_NETWORK (wrong claim floor / fee UX). Call from main + build.
 */
export function assertParametersNetwork(
  bitcoinNetwork: string = BITCOIN_NETWORK,
  generatedNetwork: string = GENERATED_PARAMETERS_NETWORK,
  claimFloor: number = GENERATED_CLAIM_FLOOR_SATS,
): void {
  const expected = expectedParametersNetwork(bitcoinNetwork);
  if (generatedNetwork !== expected) {
    throw new Error(
      `[plebly] parameters network mismatch: generated=${generatedNetwork} env=${bitcoinNetwork} (claim floor ${claimFloor})`,
    );
  }
}
