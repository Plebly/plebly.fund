#!/usr/bin/env node
/**
 * Build public/sitemap.xml for GitHub Pages.
 * Prefers the Worker dynamic sitemap; merges static discovery URLs;
 * falls back to GitHub tree + static routes.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "sitemap.xml");
const SITE = "https://plebly.fund";
const WORKERS =
  process.env.VITE_WORKERS_API ||
  "https://plebly-api.securesovereigns.workers.dev";
const REPO = "Plebly/proposals";

const STATIC = [
  "/",
  "/about",
  "/propose",
  "/stats",
  "/archive",
  "/donations",
  "/reviewers",
  "/llms.txt",
  "/llms-full.txt",
  "/humans.txt",
];

function escapeXml(value) {
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

function xmlFor(urls) {
  const unique = [...new Set(urls)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map(
      (path) =>
        `  <url><loc>${escapeXml(`${SITE}${path.startsWith("/") ? path : `/${path}`}`)}</loc></url>`,
    ),
    "</urlset>",
    "",
  ].join("\n");
}

function pathsFromXml(text) {
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

async function fromWorker() {
  const res = await fetch(`${WORKERS.replace(/\/$/, "")}/sitemap.xml`, {
    headers: { Accept: "application/xml" },
  });
  if (!res.ok) throw new Error(`worker sitemap ${res.status}`);
  const text = await res.text();
  if (!text.includes("<urlset")) throw new Error("invalid worker sitemap");
  return xmlFor([...STATIC, ...pathsFromXml(text)]);
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

  const ids = [];
  for (const path of paths.slice(0, 80)) {
    try {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${REPO}/main/${path}`,
      );
      if (!raw.ok) continue;
      const text = await raw.text();
      const m = text.match(/^id:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,119})/m);
      if (m) ids.push(m[1].trim().toLowerCase());
    } catch {
      /* skip */
    }
  }
  return xmlFor([
    ...STATIC,
    ...[...new Set(ids)].map((id) => `/p/${encodeURIComponent(id)}`),
  ]);
}

async function main() {
  try {
    const body = await fromWorker();
    writeFileSync(out, body);
    console.log("Wrote sitemap.xml from Worker (+ static discovery URLs)");
    return;
  } catch (e) {
    console.warn("Worker sitemap unavailable:", (e && e.message) || e);
  }
  try {
    const body = await fromGitHub();
    writeFileSync(out, body);
    console.log("Wrote sitemap.xml from GitHub");
    return;
  } catch (e) {
    console.warn("GitHub sitemap fallback failed:", (e && e.message) || e);
  }
  writeFileSync(out, xmlFor(STATIC));
  console.log("Wrote static sitemap.xml fallback");
}

await main();
