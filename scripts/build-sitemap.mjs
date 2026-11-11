#!/usr/bin/env node
/**
 * Build public/sitemap.xml for the deployed site.
 * Prefers the Worker catalog (same source as the home page);
 * falls back to GitHub tree + static routes.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { liveWorkersApi } from "./live-api.mjs";
import {
  STATIC_PATHS,
  mergeCatalogProposals,
  sitemapPaths,
  xmlFor,
  isSitemapListing,
} from "./sitemap-urls.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "sitemap.xml");
const WORKERS = process.env.VITE_WORKERS_API || liveWorkersApi();
const REPO = "Plebly/proposals";

async function fetchCatalog(scope) {
  const res = await fetch(
    `${WORKERS.replace(/\/$/, "")}/proposals/catalog?scope=${scope}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`worker catalog ${scope} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.proposals)) throw new Error("invalid worker catalog");
  return data.proposals;
}

async function fromCatalog() {
  // Home uses scope=listed. Union with scope=all so completed rows that only
  // appear there still get a URL; declined/voided/demo are filtered out.
  const listed = await fetchCatalog("listed");
  let all = [];
  try {
    all = await fetchCatalog("all");
  } catch {
    /* listed is enough */
  }
  const listings = mergeCatalogProposals([listed, all]);
  return xmlFor(sitemapPaths(STATIC_PATHS, listings));
}

async function fromGitHub() {
  const tree = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!tree.ok) throw new Error(`github tree ${tree.status}`);
  const paths =
    (await tree.json()).tree
      ?.filter(
        (e) =>
          e.type === "blob" &&
          typeof e.path === "string" &&
          /^proposals\/(?:listed|claimed|completed)\/[^/]+\.md$/.test(e.path),
      )
      .map((e) => e.path) || [];

  const listings = [];
  for (const path of paths.slice(0, 80)) {
    try {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${REPO}/main/${path}`,
      );
      if (!raw.ok) continue;
      const text = await raw.text();
      const idMatch = text.match(
        /^id:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,119})/m,
      );
      const statusMatch = text.match(/^status:\s*["']?([A-Za-z0-9_-]+)/m);
      if (!idMatch) continue;
      const entry = {
        id: idMatch[1].trim(),
        status: statusMatch ? statusMatch[1].trim() : "listed",
      };
      if (isSitemapListing(entry)) listings.push(entry);
    } catch {
      /* skip */
    }
  }
  return xmlFor(sitemapPaths(STATIC_PATHS, listings));
}

async function main() {
  try {
    const body = await fromCatalog();
    writeFileSync(out, body);
    console.log("Wrote sitemap.xml from Worker catalog (+ static discovery URLs)");
    return;
  } catch (e) {
    console.warn("Worker catalog unavailable:", (e && e.message) || e);
  }
  try {
    const body = await fromGitHub();
    writeFileSync(out, body);
    console.log("Wrote sitemap.xml from GitHub");
    return;
  } catch (e) {
    console.warn("GitHub sitemap fallback failed:", (e && e.message) || e);
  }
  writeFileSync(out, xmlFor(sitemapPaths(STATIC_PATHS, [])));
  console.log("Wrote static sitemap.xml fallback");
}

await main();
