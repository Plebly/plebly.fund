export const PROPOSALS_REPO = "Plebly/proposals";
export const PROPOSALS_RAW = `https://raw.githubusercontent.com/${PROPOSALS_REPO}/main`;
export const PROPOSALS_API = `https://api.github.com/repos/${PROPOSALS_REPO}/contents/proposals`;

/** Cloudflare Workers API — set VITE_WORKERS_API in GitHub Actions for production builds. */
export const WORKERS_API =
  import.meta.env.VITE_WORKERS_API ||
  "https://plebly-api.securesovereigns.workers.dev";

export const MEMPOOL_API = "https://mempool.space/api";
export const CLAIM_FLOOR_SATS = 100_000;
