/** Default Workers API for this build's Bitcoin network. */
export function liveWorkersApi(bitcoinNetwork) {
  const n = String(
    bitcoinNetwork || process.env.VITE_BITCOIN_NETWORK || "signet",
  ).toLowerCase();
  if (n === "mainnet" || n === "bitcoin") return "https://api.plebly.fund";
  return "https://api.signet.plebly.fund";
}

/** Public site origin for this build's Bitcoin network. */
export function liveSiteOrigin(bitcoinNetwork) {
  const n = String(
    bitcoinNetwork || process.env.VITE_BITCOIN_NETWORK || "signet",
  ).toLowerCase();
  if (n === "mainnet" || n === "bitcoin") return "https://plebly.fund";
  return "https://signet.plebly.fund";
}
