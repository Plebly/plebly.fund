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
 * Show Lightning donate UI when mainnet, or when explicitly staging
 * against Boltz testnet (`VITE_LIGHTNING_TESTNET=1`). Signet demos stay on-chain only.
 */
export function lightningUiAllowed(): boolean {
  if (
    import.meta.env.VITE_LIGHTNING_TESTNET === "1" ||
    import.meta.env.VITE_LIGHTNING === "1"
  ) {
    return true;
  }
  const n = BITCOIN_NETWORK.toLowerCase();
  return n === "mainnet" || n === "bitcoin" || n === "testnet";
}

export const MEMPOOL_API =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet/api"
    : "https://mempool.space/api";

export {
  CLAIM_FLOOR_SATS,
  MILESTONE_THRESHOLD_SATS,
  PLATFORM_FEE_PERCENT,
  SUBMISSION_FEE_SATS,
} from "./generated/parameters";
