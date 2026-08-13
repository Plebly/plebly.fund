import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const proposalsRepo =
  process.env.PROPOSALS_REPO || "Plebly/proposals";
const proposalsRaw = `https://raw.githubusercontent.com/${proposalsRepo}/main`;

function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function loadRepoMarkdown(filename, envPathKey) {
  const localPath = join(root, `../proposals/${filename}`);
  if (process.env[envPathKey] && existsSync(process.env[envPathKey])) {
    return readFileSync(process.env[envPathKey], "utf8");
  }
  if (existsSync(localPath)) {
    return readFileSync(localPath, "utf8");
  }
  const res = await fetch(`${proposalsRaw}/${filename}`);
  if (!res.ok) {
    throw new Error(
      `Could not fetch ${filename} (${res.status}). Set ${envPathKey} for offline builds.`,
    );
  }
  return res.text();
}

async function loadKeyholdersMarkdown() {
  return loadRepoMarkdown("KEYHOLDERS.md", "KEYHOLDERS_PATH");
}

function formatSats(n) {
  return `${Number(n).toLocaleString("en-US")} sats`;
}

async function loadParametersDoc() {
  const envPath = process.env.PARAMETERS_JSON_PATH;
  if (envPath && existsSync(envPath)) {
    return JSON.parse(readFileSync(envPath, "utf8"));
  }
  const localPath = join(root, "../proposals/parameters.json");
  if (existsSync(localPath)) {
    return JSON.parse(readFileSync(localPath, "utf8"));
  }
  const res = await fetch(`${proposalsRaw}/parameters.json`);
  if (!res.ok) {
    throw new Error(
      `Could not fetch parameters.json (${res.status}). Set PARAMETERS_JSON_PATH for offline builds.`,
    );
  }
  return res.json();
}

function resolveNetworkParams(doc, bitcoinNetwork) {
  const network = bitcoinNetwork === "signet" ? "signet" : "mainnet";
  const overlay = doc.networks?.[network];
  if (!doc.shared || !overlay || typeof overlay.claim_floor_sats !== "number") {
    throw new Error(`parameters.json missing shared/networks.${network}`);
  }
  return {
    ...doc.shared,
    claim_floor_sats: overlay.claim_floor_sats,
    submission_fee_address: overlay.submission_fee_address ?? null,
    claim_floor_note: overlay.claim_floor_note,
    network,
  };
}

/** Template placeholders for content/about.md */
function aboutPlaceholders(p) {
  const khPct = p.keyholder_fee_percent ?? 2;
  return {
    submission_fee: `${formatSats(p.submission_fee_sats)} (exact, non-refundable)`,
    platform_fee: `${p.platform_fee_percent + khPct}% (${p.platform_fee_percent}% platform, ${khPct}% keyholders)`,
    minimum_funding_claim_floor: formatSats(p.claim_floor_sats),
    claim_window: `${p.claim_window_days} days`,
    claim_extension: `One ${p.claim_extension_days}-day extension if reviewers agree.`,
    milestone_threshold: formatSats(p.milestone_threshold_sats),
  };
}

/** Strip markdown links / emphasis for plain status lines. */
function plainText(md) {
  return String(md || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Public about copy: drop Worker/API internals from KEYHOLDERS lead text. */
function publicLeadText(md) {
  const text = plainText(md);
  if (!text) return "";
  return text
    .split(/(?<=\.)\s+/)
    .filter((sentence) => {
      const s = sentence.toLowerCase();
      return !(
        s.includes("workers") ||
        s.includes("pending_keyholders") ||
        s.includes("/escrow") ||
        s.includes("501") ||
        s.includes("wrangler") ||
        s.includes("npm run deploy") ||
        s.includes("test_escrow") ||
        s.includes("sparrow") ||
        s.includes("descriptor") ||
        s.includes("human publish")
      );
    })
    .join(" ")
    .trim();
}

/** Never ship KEYHOLDERS.md ops status lines to the public site. */
function publicKeyholderStatus(status) {
  const text = plainText(status || "");
  if (!text) return "";
  if (/TBD|human publish|descriptor|ops sequence|stall runbook/i.test(text)) {
    return "";
  }
  if (/workers|pending_keyholders|501|wrangler|secret|github_app/i.test(text)) {
    return "";
  }
  return text;
}

function extractH1Blocks(md) {
  const blocks = [];
  const parts = md.split(/^#\s+/m).filter((c) => c.trim());
  for (const chunk of parts) {
    const nl = chunk.indexOf("\n");
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const body = (nl === -1 ? "" : chunk.slice(nl + 1)).trim();
    blocks.push({ title, body });
  }
  return blocks;
}

function extractH2Section(body, titleMatch) {
  const sections = body.split(/^##\s+/m).filter((c) => c.trim());
  for (const chunk of sections) {
    const nl = chunk.indexOf("\n");
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    if (!titleMatch.test(title)) continue;
    return {
      title,
      body: (nl === -1 ? "" : chunk.slice(nl + 1)).trim(),
    };
  }
  return null;
}

function parseBulletList(body) {
  const items = [];
  for (const line of body.split("\n")) {
    const m = line.trim().match(/^[-*]\s+(.+)$/);
    if (m) items.push(plainText(m[1]));
  }
  return items;
}

function parseKeyholderRoster(body) {
  const roster = [];
  for (const line of body.split("\n")) {
    const m = line.match(
      /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/,
    );
    if (!m) continue;
    const seat = m[1].trim();
    const name = m[2].trim();
    const role = m[3].trim();
    const xpub = m[4].trim();
    if (
      seat.startsWith("-") ||
      seat === "#" ||
      /^:?-+:?$/.test(seat) ||
      name.toLowerCase() === "name"
    ) {
      continue;
    }
    roster.push({ seat, name, role, xpub });
  }
  return roster;
}

function parseKeyholdersMarkdown(md) {
  const blocks = extractH1Blocks(md);
  const signet =
    blocks.find((b) => /signet/i.test(b.title)) || null;
  const production =
    blocks.find((b) => /production|keyholder/i.test(b.title)) ||
    blocks.find((b) => !/signet/i.test(b.title)) ||
    null;

  const signetNot =
    signet && extractH2Section(signet.body, /what this is not/i);
  const rulesSec =
    production && extractH2Section(production.body, /^rules$/i);
  const rosterSec =
    production && extractH2Section(production.body, /^roster/i);

  let status = "";
  let productionLead = "";
  if (production) {
    const beforeRules = production.body.split(/^##\s+/m)[0] || "";
    const statusMatch = beforeRules.match(/\*\*Status:\*\*\s*(.+)/i);
    if (statusMatch) {
      status = publicKeyholderStatus(statusMatch[1]);
    }
    productionLead = publicLeadText(
      beforeRules
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("**Status:**") && l !== "---")
        .join(" "),
    );
  }

  const thresholdMatch =
    (production?.body || md).match(/(\d\s*-\s*of\s*-\s*\d)/i) ||
    (production?.body || md).match(/(\d)\s*of\s*(\d)/i);
  const threshold = thresholdMatch
    ? thresholdMatch[0].replace(/\s+/g, "")
    : "3-of-5";

  return {
    threshold,
    status,
    productionLead,
    rules: rulesSec ? parseBulletList(rulesSec.body) : [],
    roster: rosterSec ? parseKeyholderRoster(rosterSec.body) : [],
    signetCaveats: signetNot ? parseBulletList(signetNot.body) : [],
    signetLead: signet
      ? plainText(
          (signet.body.split(/^##\s+/m)[0] || "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join(" "),
        )
      : "",
  };
}

function substitute(template, params, extras) {
  const all = { ...params, ...extras };
  return template.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, key) => {
    if (all[key] == null) {
      throw new Error(`Missing placeholder {{${key}}} in about template`);
    }
    return all[key];
  });
}

function emitTs(modulePath, body) {
  mkdirSync(dirname(modulePath), { recursive: true });
  writeFileSync(
    modulePath,
    `/* Auto-generated by scripts/build-about.mjs - do not edit */\n${body}\n`,
    "utf8",
  );
}

function splitSections(md) {
  const sections = [];
  for (const chunk of md.split(/^##\s+/m).filter((c) => c.trim())) {
    const nl = chunk.indexOf("\n");
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const body = (nl === -1 ? "" : chunk.slice(nl + 1)).trim();
    sections.push({ id: slugify(title), title, body });
  }
  return sections;
}

function parseBeliefs(body) {
  const beliefs = [];
  for (const para of body.split(/\n\n+/)) {
    const m = para.trim().match(/^\*\*([^*]+)\.\*\*\s+([\s\S]+)$/);
    if (m) beliefs.push({ title: m[1], body: marked.parseInline(m[2].trim()) });
  }
  return beliefs;
}

function parseSteps(body) {
  const steps = [];
  for (const line of body.split("\n")) {
    const m = line
      .trim()
      .match(/^\d+\.\s+\*\*([^*:]+?)(?::)?\*\*:?\s*(?:[—–-]\s*)?(.+)$/);
    if (m) steps.push({ title: m[1].trim(), body: m[2].trim() });
  }
  return steps;
}

async function main() {
  const keyholdersMd = await loadKeyholdersMarkdown();
  const keyholders = parseKeyholdersMarkdown(keyholdersMd);
  const template = readFileSync(join(root, "content/about.md"), "utf8");

  const network = (process.env.VITE_BITCOIN_NETWORK || "signet").toLowerCase();
  const bitcoinNetwork = network === "signet" ? "signet" : "mainnet";
  const doc = await loadParametersDoc();
  const resolved = resolveNetworkParams(doc, bitcoinNetwork);
  const params = aboutPlaceholders(resolved);
  const aboutMd = substitute(template, params, { bitcoin_network: bitcoinNetwork });

  const aboutHtml = marked.parse(aboutMd, { async: false });
  const sections = splitSections(aboutMd);
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const intro = byId.about_plebly;
  const beliefs = parseBeliefs(byId.what_we_believe?.body || "");
  const steps = parseSteps(byId.how_it_works?.body || "");
  const genDir = join(root, "src/generated");

  emitTs(
    join(genDir, "about-html.ts"),
    `export const ABOUT_HTML = ${JSON.stringify(aboutHtml)};`,
  );

  emitTs(
    join(genDir, "about-data.ts"),
    `export type AboutBelief = { title: string; body: string };
export type AboutStep = { title: string; body: string };
export type AboutParamDisplay = { label: string; value: string; hint: string };

export const ABOUT_INTRO_HTML = ${JSON.stringify(
      intro ? marked.parse(intro.body, { async: false }) : "",
    )};

export const ABOUT_LIGHTNING_HTML = ${JSON.stringify(
      (byId.lightning || byId.lightning_donations)
        ? marked.parse((byId.lightning || byId.lightning_donations).body, { async: false })
        : "",
    )};

export const ABOUT_BUILDERS_HTML = ${JSON.stringify(
      byId.for_builders
        ? marked.parse(byId.for_builders.body, { async: false })
        : "",
    )};

export const ABOUT_ENDOWMENT_HTML = ${JSON.stringify(
      byId.endowment
        ? marked.parse(byId.endowment.body, { async: false })
        : "",
    )};

export const ABOUT_TRUST_HTML = ${JSON.stringify(
      (byId.trust || byId.trust_model)
        ? marked.parse((byId.trust || byId.trust_model).body, { async: false })
        : "",
    )};

export const ABOUT_BELIEFS: AboutBelief[] = ${JSON.stringify(beliefs, null, 2)};

export const ABOUT_STEPS: AboutStep[] = ${JSON.stringify(steps, null, 2)};

export const ABOUT_PARAM_LABELS: AboutParamDisplay[] = ${JSON.stringify(
      [
        {
          label: "Submission fee",
          value: params.submission_fee,
          hint: "Paid when you open a proposal.",
        },
        {
          label: "Platform fee",
          value: params.platform_fee,
          hint: "Taken when the project is paid, not when you donate.",
        },
        {
          label: "Opens for builders",
          value: params.minimum_funding_claim_floor,
          hint: "Builders can apply once this amount is in.",
        },
        {
          label: "Time to deliver",
          value: params.claim_window,
          hint: params.claim_extension || "Extension via reviewer vote.",
        },
        {
          label: "Milestone threshold",
          value: params.milestone_threshold,
          hint: "Milestone splits apply above this amount.",
        },
      ],
      null,
      2,
    )};

export type AboutKeyholderSeat = {
  seat: string;
  name: string;
  role: string;
  xpub: string;
};

export type AboutKeyholders = {
  threshold: string;
  status: string;
  productionLead: string;
  rules: string[];
  roster: AboutKeyholderSeat[];
  signetCaveats: string[];
  signetLead: string;
};

export const ABOUT_KEYHOLDERS: AboutKeyholders = ${JSON.stringify(
      keyholders,
      null,
      2,
    )};

export const ABOUT_BITCOIN_NETWORK = ${JSON.stringify(bitcoinNetwork)};`,
  );

  emitTs(
    join(genDir, "parameters.ts"),
    `export const SUBMISSION_FEE_SATS = ${resolved.submission_fee_sats};
export const CLAIM_FLOOR_SATS = ${resolved.claim_floor_sats};
export const MILESTONE_THRESHOLD_SATS = ${resolved.milestone_threshold_sats};
export const PLATFORM_FEE_PERCENT = ${resolved.platform_fee_percent};
export const KEYHOLDER_FEE_PERCENT = ${resolved.keyholder_fee_percent ?? 2};
export const KEYHOLDER_CAP_SATS = ${resolved.keyholder_cap_sats ?? 500000};
export const CLAIM_BOND_SATS = ${resolved.claim_bond_sats};
export const MAX_ACTIVE_CLAIMS = ${resolved.max_active_claims};
export const CLAIM_PENDING_TTL_HOURS = ${resolved.claim_pending_ttl_hours};
export const RECLAIM_COOLDOWN_DAYS = ${resolved.reclaim_cooldown_days};
export const CLAIM_CHECKPOINT_DAY = ${resolved.claim_checkpoint_day};
export const CLAIM_CHECKPOINT_GRACE_DAYS = ${resolved.claim_checkpoint_grace_days};
export const CLAIM_ABUSE_ESCALATION_THRESHOLD = ${resolved.claim_abuse_escalation_threshold};
export const CORE_ANNUAL_GAP_SATS = ${resolved.core_annual_gap_sats};
export const MAX_SITE_CLAIM_PRS_PER_DAY = ${resolved.max_site_claim_prs_per_day};
export const IDENTITY_RELINK_COOLDOWN_DAYS = ${resolved.identity_relink_cooldown_days};
export const CLAIM_WINDOW_DAYS = ${resolved.claim_window_days};
export const CLAIM_EXTENSION_DAYS = ${resolved.claim_extension_days};
export const FUNDING_WINDOW_DAYS = ${resolved.funding_window_days};
export const FUNDING_WINDOW_EXTENSION_DAYS = ${resolved.funding_window_extension_days};
export const DELIVERY_WINDOW_DAYS = ${resolved.delivery_window_days};
export const FUNDING_CONFIRMATIONS = ${resolved.funding_confirmations};
export const BADGE_NOTABLE_SATS = ${resolved.badge_notable_sats};
export const BADGE_MAJOR_SATS = ${resolved.badge_major_sats};
export const BADGE_PATRON_SATS = ${resolved.badge_patron_sats};
export const PLEBLY_PARAMETERS_NETWORK = ${JSON.stringify(resolved.network)} as const;`,
  );

  console.log(
    `Generated about page from parameters.json (${bitcoinNetwork}) + KEYHOLDERS.md (${keyholders.roster.length} seats)`,
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
