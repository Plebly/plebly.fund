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

export const MEMPOOL_API =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet/api"
    : "https://mempool.space/api";

export const CLAIM_FLOOR_SATS = 100_000;
