import { BITCOIN_NETWORK } from "./config";
import { escapeHtml } from "./util";

/** True when the SPA build targets Bitcoin signet (test coins). */
export function isSignet(): boolean {
  return BITCOIN_NETWORK.toLowerCase() === "signet";
}

export const SIGNET_EXPLORER = "https://mempool.space/signet";

/** Public signet faucets — test coins only, never mainnet value. */
export const SIGNET_FAUCETS = [
  { label: "Alt Signet faucet", url: "https://signet25.bublina.eu.org/" },
  { label: "signetfaucet.com", url: "https://signetfaucet.com/" },
] as const;

export function signetFaucetLinksHtml(opts?: { className?: string }): string {
  if (!isSignet()) return "";
  const cls = opts?.className ? ` class="${escapeHtml(opts.className)}"` : "";
  const links = SIGNET_FAUCETS.map(
    (f) =>
      `<a href="${escapeHtml(f.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(f.label)}</a>`,
  ).join('<span aria-hidden="true"> · </span>');
  return `<span${cls}>${links}</span>`;
}

/**
 * Persistent site chrome when on signet — every page, not only the hero badge.
 * Empty string on mainnet/testnet builds.
 */
export function signetSiteBannerHtml(): string {
  if (!isSignet()) return "";
  return `<aside class="signet-banner" role="status" aria-label="Signet test network">
    <div class="wrap-wide signet-banner-inner">
      <p class="signet-banner-text">
        <strong>Signet</strong> — test coins only. Mainnet Bitcoin will not work here.
      </p>
      <p class="signet-banner-links">
        Get free signet sats:
        ${signetFaucetLinksHtml({ className: "signet-faucet-links" })}
        <span aria-hidden="true"> · </span>
        <a href="${SIGNET_EXPLORER}" target="_blank" rel="noreferrer noopener">Signet explorer</a>
      </p>
    </div>
  </aside>`;
}

/** Compact note for donate / fee-pay surfaces. */
export function signetPayNoteHtml(kind: "donate" | "fee" = "donate"): string {
  if (!isSignet()) return "";
  const action =
    kind === "fee"
      ? "Pay fees from a <strong>signet</strong> wallet."
      : "Donate from a <strong>signet</strong> wallet — mainnet payments will not credit this escrow.";
  return `<p class="donate-network-note signet-pay-note" role="status">
    ${action}
    Need coins?
    ${signetFaucetLinksHtml({ className: "signet-faucet-links" })}
  </p>`;
}

/** Short hero / page-header callout (home). */
export function signetHeroNoteHtml(): string {
  if (!isSignet()) return "";
  return `<p class="signet-hero-note" role="status">
    Soft launch on <strong>signet</strong> (test network). Use a signet wallet;
    get coins from ${signetFaucetLinksHtml({ className: "signet-faucet-links" })}.
  </p>`;
}
