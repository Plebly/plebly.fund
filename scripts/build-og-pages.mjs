#!/usr/bin/env node
/**
 * Emit static HTML shells with route-specific OG/Twitter/JSON-LD + readable body
 * so crawlers hitting GitHub Pages get real titles/descriptions without JS.
 *
 * - dist/p/{id}/index.html for proposals
 * - dist/{about,propose,stats,reviewers}/index.html for key marketing routes
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

const STATIC_ROUTES = [
  {
    path: "/about",
    title: "About Plebly",
    description:
      "Non-custodial escrow, uncensorable proposals, and protocol-over-platform rules for Bitcoin public goods funding.",
  },
  {
    path: "/propose",
    title: "Start a project",
    description:
      "Propose Bitcoin development or research work, pay the on-chain submission fee, and list it for public funding.",
  },
  {
    path: "/stats",
    title: "Funding stats",
    description:
      "Public, best-effort funding and completion totals for Plebly Bitcoin work.",
  },
  {
    path: "/reviewers",
    title: "Reviewers",
    description:
      "Active reviewer roster, open decisions, and funder removal ballots on Plebly.",
  },
];

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

function setMeta(html, attr, key, value) {
  const re = new RegExp(
    `<meta\\s+${attr}="${key}"\\s+content="[^"]*"\\s*/?>`,
    "i",
  );
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace("</head>", `  ${tag}\n  </head>`);
}

function replaceShell(html, attrs) {
  let out = html;
  out = setMeta(out, "name", "description", attrs.description);
  out = setMeta(out, "property", "og:title", attrs.title);
  out = setMeta(out, "property", "og:description", attrs.description);
  out = setMeta(out, "property", "og:url", attrs.url);
  out = setMeta(out, "property", "og:type", attrs.type || "website");
  out = setMeta(out, "property", "og:image", attrs.image || `${SITE}/logo.jpeg`);
  out = setMeta(out, "property", "og:image:alt", attrs.title);
  out = setMeta(out, "name", "twitter:title", attrs.title);
  out = setMeta(out, "name", "twitter:description", attrs.description);
  out = setMeta(out, "name", "twitter:image", attrs.image || `${SITE}/logo.jpeg`);
  out = setMeta(out, "name", "twitter:site", "@joinplebly");
  out = setMeta(
    out,
    "name",
    "twitter:card",
    attrs.image && attrs.image !== `${SITE}/logo.jpeg`
      ? "summary_large_image"
      : "summary",
  );
  out = out.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(attrs.title)}</title>`,
  );
  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${escapeHtml(attrs.url)}" />`,
  );

  const jsonLd = attrs.jsonLd
    ? `<script type="application/ld+json" id="plebly-jsonld">${JSON.stringify(attrs.jsonLd)}</script>`
    : "";
  // Replace any existing homepage graph JSON-LD with route-specific data.
  out = out.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
    jsonLd || "",
  );

  const body = `<main>
        <h1>${escapeHtml(attrs.heading || attrs.title)}</h1>
        <p>${escapeHtml(attrs.description)}</p>
        <p><a href="${escapeHtml(attrs.url)}">Open on Plebly</a></p>
      </main>`;
  out = out.replace(
    /<div id="app">[\s\S]*?<\/div>\s*<script type="module"/i,
    `<div id="app">\n      ${body}\n    </div>\n    <script type="module"`,
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
      ids.push(decodeURIComponent(match[1]).trim().toLowerCase());
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
      const id = text
        .match(/^id:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,119})/m)?.[1]
        ?.trim()
        .toLowerCase();
      const title =
        text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || id;
      if (id) out.push({ id, title, path });
    } catch {
      /* skip */
    }
  }
  return out;
}

function parseProposalMeta(text, id) {
  const title =
    text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || id;
  const status =
    text.match(/^status:\s*["']?([A-Za-z0-9_-]+)/m)?.[1]?.trim() || "listed";
  const cover =
    text.match(/^cover_image:\s*["']?(\S+?)["']?\s*$/m)?.[1]?.trim() || null;
  const problem =
    text
      .split(/^##\s+Problem\s*$/im)[1]
      ?.split(/^##\s+/m)[0]
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "";
  return {
    title: `${title} · Plebly`,
    heading: title,
    description:
      problem ||
      "Fund open Bitcoin work with publicly verifiable on-chain escrow.",
    image:
      cover && /^https:\/\//i.test(cover) ? cover : `${SITE}/logo.jpeg`,
    status,
  };
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
        if (raw.ok) return parseProposalMeta(await raw.text(), id);
      }
    }
  } catch {
    /* fall through */
  }
  return {
    title: `${id} · Plebly`,
    heading: id,
    description:
      "Fund open Bitcoin work with publicly verifiable on-chain escrow.",
    image: `${SITE}/logo.jpeg`,
    status: "listed",
  };
}

function writeShell(relDir, html) {
  const dir = join(dist, ...relDir.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
}

async function main() {
  if (!existsSync(indexPath)) {
    console.error("build-og-pages: dist/index.html missing");
    process.exit(1);
  }
  const template = readFileSync(indexPath, "utf8");

  let n = 0;
  for (const route of STATIC_ROUTES) {
    const url = `${SITE}${route.path}`;
    const html = replaceShell(template, {
      title: route.title.includes("Plebly")
        ? route.title
        : `${route.title} · Plebly`,
      heading: route.title,
      description: route.description,
      url,
      type: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: route.title,
        description: route.description,
        url,
        isPartOf: { "@type": "WebSite", name: "Plebly", url: `${SITE}/` },
      },
    });
    writeShell(route.path, html);
    n += 1;
  }

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
      console.log(`Wrote ${n} static route shells under dist/`);
      return;
    }
  }

  for (const entry of entries) {
    const id = String(entry.id || "")
      .trim()
      .toLowerCase();
    if (!id) continue;
    const meta = entry.title
      ? {
          title: `${entry.title} · Plebly`,
          heading: entry.title,
          description:
            "Fund open Bitcoin work with publicly verifiable on-chain escrow.",
          image: `${SITE}/logo.jpeg`,
          status: "listed",
        }
      : await metaForId(id);
    const url = `${SITE}/p/${encodeURIComponent(id)}`;
    const html = replaceShell(template, {
      title: meta.title,
      heading: meta.heading,
      description: meta.description,
      url,
      type: "article",
      image: meta.image,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "FundingCampaign",
        name: meta.heading,
        description: meta.description,
        url,
        identifier: id,
        creativeWorkStatus: meta.status,
        ...(meta.image !== `${SITE}/logo.jpeg` ? { image: meta.image } : {}),
        funder: { "@type": "Organization", name: "Plebly", url: `${SITE}/` },
      },
    });
    writeShell(`p/${id}`, html);
    n += 1;
  }
  console.log(`Wrote ${n} OG shells under dist/`);
}

await main();
