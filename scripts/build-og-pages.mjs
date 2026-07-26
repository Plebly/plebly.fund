#!/usr/bin/env node
/**
 * Emit dist/p/{id}/index.html shells with proposal-specific OG/Twitter meta
 * so crawlers hitting GitHub Pages get real titles/descriptions without JS.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const indexPath = join(dist, "index.html");
const SITE = "https://plebly.fund";
const WORKERS =
  process.env.VITE_WORKERS_API ||
  "https://plebly-api.securesovereigns.workers.dev";
const REPO = "Plebly/proposals";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char],
  );
}

function replaceMeta(html, attrs) {
  let out = html;
  const set = (attr, key, value) => {
    const re = new RegExp(
      `<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/?>`,
      "i",
    );
    const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
    if (re.test(out)) out = out.replace(re, tag);
    else out = out.replace("</head>", `  ${tag}\n  </head>`);
  };
  set("name", "description", attrs.description);
  set("property", "og:title", attrs.title);
  set("property", "og:description", attrs.description);
  set("property", "og:url", attrs.url);
  set("property", "og:type", "article");
  set("name", "twitter:title", attrs.title);
  set("name", "twitter:description", attrs.description);
  out = out.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(attrs.title)}</title>`,
  );
  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${escapeHtml(attrs.url)}" />`,
  );
  return out;
}

async function listFromWorker() {
  const res = await fetch(`${WORKERS.replace(/\/$/, "")}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap ${res.status}`);
  const text = await res.text();
  const ids = [];
  for (const match of text.matchAll(/\/p\/([^<]+)</g)) {
    try {
      ids.push(decodeURIComponent(match[1]));
    } catch {
      /* skip */
    }
  }
  return [...new Set(ids)];
}

async function listFromGitHub() {
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

  const out = [];
  for (const path of paths.slice(0, 120)) {
    try {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${REPO}/main/${path}`,
      );
      if (!raw.ok) continue;
      const text = await raw.text();
      const id = text.match(/^id:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,119})/m)?.[1];
      const title =
        text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || id;
      if (id) out.push({ id, title, path });
    } catch {
      /* skip */
    }
  }
  return out;
}

async function metaForId(id) {
  try {
    const lookup = await fetch(
      `${WORKERS.replace(/\/$/, "")}/proposals/lookup/${encodeURIComponent(id)}`,
    );
    if (lookup.ok) {
      const { path } = await lookup.json();
      if (path) {
        const raw = await fetch(
          `https://raw.githubusercontent.com/${REPO}/main/${path}`,
        );
        if (raw.ok) {
          const text = await raw.text();
          const title =
            text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || id;
          const problem =
            text
              .split(/^##\s+Problem\s*$/im)[1]
              ?.split(/^##\s+/m)[0]
              ?.replace(/\s+/g, " ")
              .trim()
              .slice(0, 180) || "";
          return {
            title: `${title} · Plebly`,
            description:
              problem ||
              "Fund open Bitcoin work with publicly verifiable on-chain escrow.",
          };
        }
      }
    }
  } catch {
    /* fall through */
  }
  return {
    title: `${id} · Plebly`,
    description:
      "Fund open Bitcoin work with publicly verifiable on-chain escrow.",
  };
}

async function main() {
  if (!existsSync(indexPath)) {
    console.error("build-og-pages: dist/index.html missing");
    process.exit(1);
  }
  const template = readFileSync(indexPath, "utf8");
  let entries = [];
  try {
    const ids = await listFromWorker();
    entries = ids.map((id) => ({ id }));
    console.log(`OG pages: ${ids.length} ids from Worker sitemap`);
  } catch (e) {
    console.warn("Worker sitemap unavailable:", e.message || e);
    try {
      entries = await listFromGitHub();
      console.log(`OG pages: ${entries.length} ids from GitHub`);
    } catch (err) {
      console.warn("GitHub OG fallback failed:", err.message || err);
      return;
    }
  }

  let n = 0;
  for (const entry of entries) {
    const id = entry.id;
    if (!id) continue;
    const meta = entry.title
      ? {
          title: `${entry.title} · Plebly`,
          description:
            "Fund open Bitcoin work with publicly verifiable on-chain escrow.",
        }
      : await metaForId(id);
    const url = `${SITE}/p/${encodeURIComponent(id)}`;
    const html = replaceMeta(template, {
      title: meta.title,
      description: meta.description,
      url,
    });
    const dir = join(dist, "p", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
    n += 1;
  }
  console.log(`Wrote ${n} OG shells under dist/p/`);
}

await main();
