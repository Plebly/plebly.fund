export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** QR module colors from live CSS theme tokens. */
export function themeQrColors(): { dark: string; light: string } {
  try {
    const styles = getComputedStyle(document.documentElement);
    const dark = styles.getPropertyValue("--bg").trim() || "#0c0b10";
    const light = styles.getPropertyValue("--ink").trim() || "#f2f0f6";
    return { dark, light };
  } catch {
    return { dark: "#0c0b10", light: "#f2f0f6" };
  }
}

export function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

/** BIP21 URI; optional amount in sats → BTC. */
export function bitcoinUri(address: string, amountSats?: number | null): string {
  if (amountSats != null && amountSats > 0) {
    const btc = (amountSats / 1e8).toFixed(8).replace(/\.?0+$/, "");
    return `bitcoin:${address}?amount=${btc}`;
  }
  return `bitcoin:${address}`;
}

const PROPOSALS_PREFIX = "proposals/";

/** Repo path → URL slug, e.g. proposals/listed/foo.md → listed/foo */
export function proposalSlug(repoPath: string): string {
  let slug = repoPath.trim().replace(/^\/+/, "");
  if (slug.startsWith(PROPOSALS_PREFIX)) {
    slug = slug.slice(PROPOSALS_PREFIX.length);
  }
  if (slug.endsWith(".md")) {
    slug = slug.slice(0, -3);
  }
  return slug;
}

/** URL slug → repo path, e.g. listed/foo → proposals/listed/foo.md */
export function proposalRepoPath(slug: string): string {
  let path = decodeURIComponent(slug.trim()).replace(/^\/+/, "");
  if (path.startsWith(PROPOSALS_PREFIX)) {
    return path.endsWith(".md") ? path : `${path}.md`;
  }
  return `${PROPOSALS_PREFIX}${path.endsWith(".md") ? path : `${path}.md`}`;
}
