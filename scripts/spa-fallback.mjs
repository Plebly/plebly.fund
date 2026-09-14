import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** GitHub Pages serves 404.html for unknown paths; copy index for SPA routes. */
const dist = join(process.cwd(), "dist");
const index = join(dist, "index.html");
const fallback = join(dist, "404.html");

if (!existsSync(index)) {
  console.error("spa-fallback: dist/index.html missing; run vite build first");
  process.exit(1);
}

const api = (
  process.env.VITE_WORKERS_API ||
  "https://plebly-api.securesovereigns.workers.dev"
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
].join("; ");
const meta = `    <meta http-equiv="Content-Security-Policy" content="${csp}" />`;

let html = readFileSync(index, "utf8");
if (!html.includes("Content-Security-Policy")) {
  html = html.replace("<head>", `<head>\n${meta}`);
  writeFileSync(index, html);
  console.log("Injected production CSP meta into dist/index.html");
}

copyFileSync(index, fallback);
console.log("Wrote dist/404.html for SPA deep links");
