/**
 * Shared sitemap URL helpers for the fund site build.
 * Listing URLs come from the Worker catalog (same source as the home page).
 */
export const SITE = "https://plebly.fund";

/** Static discovery routes. File-like paths keep no trailing slash. */
export const STATIC_PATHS = [
  "/",
  "/about",
  "/propose",
  "/stats",
  "/archive",
  "/donations",
  "/reviewers",
  "/keyholder-responsibilities",
  "/reviewer-responsibilities",
  "/terms",
  "/llms.txt",
  "/llms-full.txt",
  "/humans.txt",
];

/** Signet smoke-test bounty: still loads at its URL, but is not on the home rails. */
const DEMO_IDS = new Set(["plebly-signet-demo"]);

const EXCLUDED_STATUS = new Set(["declined", "voided"]);

export function isDemoListingId(id) {
  return DEMO_IDS.has(String(id || "").trim().toLowerCase());
}

export function isSitemapListing(entry) {
  if (!entry || isDemoListingId(entry.id)) return false;
  const status = String(entry.status || "").toLowerCase();
  if (EXCLUDED_STATUS.has(status)) return false;
  const id = String(entry.id || "").trim();
  return Boolean(id);
}

/**
 * Canonical path for the sitemap. HTML routes get a trailing slash so
 * Cloudflare auto-trailing-slash does not 307. Real files keep no slash.
 */
export function canonicalSitemapPath(path) {
  let p = String(path || "").trim();
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.split("?")[0].split("#")[0];
  if (p === "/") return "/";
  if (/\.[A-Za-z0-9]+$/.test(p)) return p.replace(/\/+$/, "");
  return `${p.replace(/\/+$/, "")}/`;
}

export function listingPath(id) {
  return canonicalSitemapPath(
    `/p/${encodeURIComponent(String(id).trim().toLowerCase())}`,
  );
}

export function sitemapPaths(staticPaths, listings) {
  const urls = [
    ...staticPaths.map(canonicalSitemapPath),
    ...listings.filter(isSitemapListing).map((entry) => listingPath(entry.id)),
  ];
  return [...new Set(urls)];
}

export function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (char) =>
    ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    })[char],
  );
}

export function xmlFor(paths, site = SITE) {
  const unique = [...new Set(paths.map(canonicalSitemapPath))];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map(
      (path) => `  <url><loc>${escapeXml(`${site}${path}`)}</loc></url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");
}

export function pathsFromXml(text) {
  const paths = [];
  for (const match of text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const url = new URL(match[1]);
      paths.push(url.pathname === "" ? "/" : url.pathname);
    } catch {
      /* skip */
    }
  }
  return paths;
}

export function listingIdsFromCatalog(proposals) {
  return [
    ...new Set(
      (Array.isArray(proposals) ? proposals : [])
        .filter(isSitemapListing)
        .map((entry) => String(entry.id).trim().toLowerCase()),
    ),
  ];
}

/** Merge catalog scopes, first id wins (listed, then all). */
export function mergeCatalogProposals(groups) {
  const byId = new Map();
  for (const list of groups) {
    for (const entry of Array.isArray(list) ? list : []) {
      const id = String(entry?.id || "").trim().toLowerCase();
      if (id && !byId.has(id)) byId.set(id, entry);
    }
  }
  return [...byId.values()];
}
