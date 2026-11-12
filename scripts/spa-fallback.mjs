import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { liveWorkersApi } from "./live-api.mjs";

/** GitHub Pages and Cloudflare 404-page handling serve 404.html for unknown paths. */
const dist = join(process.cwd(), "dist");
const index = join(dist, "index.html");
const fallback = join(dist, "404.html");

if (!existsSync(index)) {
  console.error("spa-fallback: dist/index.html missing; run vite build first");
  process.exit(1);
}

const api = (
  process.env.VITE_WORKERS_API || liveWorkersApi()
).replace(/\/$/, "");
const connectSrc = [
  "'self'",
  api,
  "https://mempool.space",
  "https://mempool.space/signet",
  "https://mempool.space/signet/api",
  "https://mempool.space/testnet",
  "https://mempool.space/testnet/api",
  "https://mempool.space/api",
  "https://api.github.com",
  "https://raw.githubusercontent.com",
].join(" ");
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  `connect-src ${connectSrc}`,
  "img-src 'self' https: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");
const meta = `    <meta http-equiv="Content-Security-Policy" content="${csp}" />`;

let html = readFileSync(index, "utf8");
if (!html.includes("Content-Security-Policy")) {
  html = html.replace("<head>", `<head>\n${meta}`);
  writeFileSync(index, html);
  console.log("Injected production CSP meta into dist/index.html");
}

copyFileSync(index, fallback);
console.log("Wrote dist/404.html for unknown paths (HTTP 404)");

/** Exact SPA paths that should stay HTTP 200 under not_found_handling=404-page. */
const SPA_SHELL_ROUTES = [
  "about",
  "stats",
  "archive",
  "completed",
  "declined",
  "donations",
  "keyholders",
  "keyholder-responsibilities",
  "docs/keyholder-responsibilities",
  "parameters",
  "terms",
  "account",
  "work",
  "propose",
  "submit",
  "reviewers",
  "governance",
  "reviewer-responsibilities",
  "reviewer-rules",
  "wanted",
  "endowment",
  "admin",
  "home",
];

for (const route of SPA_SHELL_ROUTES) {
  const dest = join(dist, route, "index.html");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(index, dest);
}
console.log(`Wrote ${SPA_SHELL_ROUTES.length} SPA shell routes`);
