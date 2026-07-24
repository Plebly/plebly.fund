export const PROPOSALS_REPO = "Plebly/proposals";
export const PROPOSALS_RAW = `https://raw.githubusercontent.com/${PROPOSALS_REPO}/main`;
export const PROPOSALS_API = `https://api.github.com/repos/${PROPOSALS_REPO}/contents/proposals`;
export const WORKERS_API =
  (import.meta as ImportMeta & { env: { VITE_WORKERS_API?: string } }).env
    .VITE_WORKERS_API || "";
export const MEMPOOL_API = "https://mempool.space/api";
export const CLAIM_FLOOR_SATS = 100_000;
