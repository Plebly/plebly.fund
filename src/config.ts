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

export const MEMPOOL_API =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet/api"
    : "https://mempool.space/api";

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
} from "./generated/parameters";
