#!/usr/bin/env node
/**
 * Refresh public/llms.txt with a curated index + live Projects section
 * (from Worker catalog when available). Follows https://llmstxt.org/
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "llms.txt");
const WORKERS =
  process.env.VITE_WORKERS_API ||
  "https://plebly-api.securesovereigns.workers.dev";
const SITE = "https://plebly.fund";

async function loadProjects() {
  try {
    const res = await fetch(
      `${WORKERS.replace(/\/$/, "")}/proposals/catalog?scope=listed`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.proposals) ? data.proposals : [];
    return list
      .filter((p) => p && typeof p.id === "string" && p.id.trim())
      .slice(0, 40)
      .map((p) => {
        const id = p.id.trim().toLowerCase();
        const title = (p.title || id).trim();
        const status = (p.status || "listed").trim();
        const note = [status, p.excerpt].filter(Boolean).join(" — ").slice(0, 120);
        return { id, title, note };
      });
  } catch (e) {
    console.warn("build-llms: catalog unavailable:", e.message || e);
    return [];
  }
}

function render(projects) {
  const projectLines =
    projects.length > 0
      ? projects.map(
          (p) =>
            `- [${p.title}](${SITE}/p/${encodeURIComponent(p.id)}): ${p.note || "Open Bitcoin work on Plebly"}`,
        )
      : [
          `- [Open projects on the home page](${SITE}/): Live listed projects (catalog unavailable at build time)`,
        ];

  return `# Plebly

> Plebly is a public funding platform for Bitcoin development and research. Donors send sats to publicly verifiable on-chain escrow. No custodian can freeze or redirect escrow.

Listings and escrow balances are on the site at ${SITE}. Published fees and keyholder rules are in git. Lightning donations (when enabled) settle into the same on-chain escrow after an on-chain sweep.

## Site

- [Home / open projects](${SITE}/): Browse listed projects and escrow funding progress
- [About](${SITE}/about): Beliefs, how it works, fees, and network status
- [Start a project](${SITE}/propose): List a bounty or campaign (login; on-chain fee required)
- [Funding stats](${SITE}/stats): Public funding and completion totals
- [Reviewers](${SITE}/reviewers): Reviewer roster and open decisions
- [Reviewer rules](${SITE}/reviewer-responsibilities): Who can review and how a vote passes
- [Keyholder responsibilities](${SITE}/keyholder-responsibilities): What a keyholder does and how they are paid
- [Full context for LLMs](${SITE}/llms-full.txt): Longer plain-text overview of product rules and flows

## Projects

${projectLines.join("\n")}

## Protocol (published rules)

- [PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md): Fees, claim floor, windows
- [Keyholders](${SITE}/about#keyholders): Multisig roster and rules
- [TESTING.md](https://github.com/Plebly/proposals/blob/main/TESTING.md): Signet / end-to-end testing notes

## Optional

- [Sitemap](${SITE}/sitemap.xml): Machine-readable page index
- [robots.txt](${SITE}/robots.txt): Crawler policy
- [humans.txt](${SITE}/humans.txt): Site maintainers
- [Plebly on X](https://x.com/joinplebly): Product updates
- [Plebly on GitHub](https://github.com/Plebly): Organization and open source
`;
}

async function main() {
  const projects = await loadProjects();
  writeFileSync(out, render(projects));
  console.log(
    `Wrote llms.txt (${projects.length} project link${projects.length === 1 ? "" : "s"})`,
  );
}

await main();
