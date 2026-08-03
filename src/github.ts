import { PROPOSALS_API, PROPOSALS_RAW, WORKERS_API } from "./config";
import { parseFrontMatter } from "./frontmatter";
import type {
  DependsOnEntry,
  Proposal,
  ProposalMilestone,
  ProposalProposer,
  RelatedWorkEntry,
} from "./types";

export { parseFrontMatter };

type GhContent = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
};

function parseMilestones(value: unknown): ProposalMilestone[] {
  if (!Array.isArray(value)) return [];
  const out: ProposalMilestone[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || !("deliverable" in raw)) continue;
    const m = raw as Record<string, unknown>;
    const threshold = m.funding_threshold_sats;
    const funding_threshold_sats =
      typeof threshold === "number" &&
      Number.isFinite(threshold) &&
      threshold >= 1
        ? Math.floor(threshold)
        : undefined;
    out.push({
      ...(m as unknown as ProposalMilestone),
      funding_threshold_sats,
    });
  }
  return out;
}

function parseProposer(data: Record<string, unknown>): ProposalProposer | null {
  const p = data.proposer;
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  return {
    github: (o.github as string) || null,
    username: (o.username as string) || null,
    nostr: (o.nostr as string) || null,
    x: (o.x as string) || null,
  };
}

function parseDependsOn(value: unknown): DependsOnEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (d): d is DependsOnEntry =>
      !!d &&
      typeof d === "object" &&
      ((d as DependsOnEntry).kind === "plebly" ||
        (d as DependsOnEntry).kind === "external") &&
      typeof (d as DependsOnEntry).label === "string",
  );
}

function parseRelatedWork(value: unknown): RelatedWorkEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (d): d is RelatedWorkEntry =>
      !!d &&
      typeof d === "object" &&
      typeof (d as RelatedWorkEntry).label === "string" &&
      typeof (d as RelatedWorkEntry).url === "string",
  );
}

export function proposalFromMarkdown(raw: string, path: string, dir = "unknown"): Proposal {
  const { data, body } = parseFrontMatter(raw);
  return {
    id:
      typeof data.id === "string" && data.id.trim()
        ? data.id.trim()
        : null,
    title: (data.title as string) || path,
    status: (data.status as string) || dir,
    proposal_type:
      String(data.proposal_type || "bounty").toLowerCase() === "direct"
        ? "direct"
        : "bounty",
    tags: Array.isArray(data.tags)
      ? data.tags.filter((t): t is string => typeof t === "string")
      : [],
    parent_initiative:
      typeof data.parent_initiative === "string" ? data.parent_initiative : null,
    path,
    target_sats: typeof data.target_sats === "number" ? data.target_sats : null,
    escrow_address: (data.escrow_address as string) || null,
    submission_fee_txid: (data.submission_fee_txid as string) || null,
    cover_image: (data.cover_image as string) || null,
    created_at: (data.created_at as string) || null,
    escrow_index: typeof data.escrow_index === "number" ? data.escrow_index : null,
    milestones: parseMilestones(data.milestones),
    depends_on: parseDependsOn(data.depends_on),
    related_work: parseRelatedWork(data.related_work),
    proposer: parseProposer(data),
    claimer: (data.claimer as string) || null,
    claimed_at: (data.claimed_at as string) || null,
    payout_address: (data.payout_address as string) || null,
    deliverable_url: (data.deliverable_url as string) || null,
    escrow_allocated_at: (data.escrow_allocated_at as string) || null,
    funding_window_ends_at: (data.funding_window_ends_at as string) || null,
    delivery_window_ends_at: (data.delivery_window_ends_at as string) || null,
    milestones_due_at: (data.milestones_due_at as string) || null,
    release_blocked_reason: (data.release_blocked_reason as string) || null,
    body,
  };
}

async function loadProposalFile(item: GhContent, dir: string): Promise<Proposal | null> {
  if (item.type !== "file" || !item.name.endsWith(".md")) return null;
  const rawRes = await fetch(`${PROPOSALS_RAW}/${item.path}`);
  if (!rawRes.ok) return null;
  return proposalFromMarkdown(await rawRes.text(), item.path, dir);
}

export async function listProposalsInDirs(dirs: string[]): Promise<Proposal[]> {
  const out: Proposal[] = [];
  for (const dir of dirs) {
    const res = await fetch(`${PROPOSALS_API}/${dir}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const items = (await res.json()) as GhContent[];
    const loaded = await Promise.all(
      items.map((item) => loadProposalFile(item, dir)),
    );
    for (const p of loaded) {
      if (p) out.push(p);
    }
  }
  return out;
}

const LISTED_TTL_MS = 60_000;
let listedCache: { at: number; data: Proposal[]; scope: "listed" | "all" } | null =
  null;

type CatalogProposal = {
  id: string | null;
  path: string;
  title: string;
  status: string;
  proposal_type?: string;
  tags?: string[];
  cover_image?: string | null;
  excerpt?: string;
  created_at?: string | null;
  target_sats?: number | null;
  escrow_address?: string | null;
  balance_sats?: number | null;
  funding_window_ends_at?: string | null;
  delivery_window_ends_at?: string | null;
  claimer?: string | null;
  proposer?: ProposalProposer | null;
  rescue?: boolean;
  rescue_gap_sats?: number | null;
};

function proposalFromCatalog(entry: CatalogProposal): Proposal {
  return {
    id: entry.id,
    path: entry.path,
    title: entry.title,
    status: entry.status,
    proposal_type:
      String(entry.proposal_type || "bounty").toLowerCase() === "direct"
        ? "direct"
        : "bounty",
    tags: entry.tags || [],
    cover_image: entry.cover_image ?? null,
    created_at: entry.created_at ?? null,
    target_sats: entry.target_sats ?? null,
    escrow_address: entry.escrow_address ?? null,
    balance_sats:
      typeof entry.balance_sats === "number" ? entry.balance_sats : undefined,
    funding_window_ends_at: entry.funding_window_ends_at ?? null,
    delivery_window_ends_at: entry.delivery_window_ends_at ?? null,
    claimer: entry.claimer ?? null,
    proposer: entry.proposer ?? null,
    submission_fee_txid: null,
    escrow_index: null,
    milestones: [],
    body: entry.excerpt || "",
    rescue: Boolean(entry.rescue),
    rescue_gap_sats:
      typeof entry.rescue_gap_sats === "number" ? entry.rescue_gap_sats : null,
  };
}

async function fetchWorkerCatalog(
  scope: "listed" | "all",
): Promise<Proposal[] | null> {
  if (!WORKERS_API) return null;
  try {
    const res = await fetch(
      `${WORKERS_API.replace(/\/$/, "")}/proposals/catalog?scope=${scope}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { proposals?: CatalogProposal[] };
    if (!Array.isArray(data.proposals)) return null;
    return data.proposals.map(proposalFromCatalog);
  } catch {
    return null;
  }
}

/** Listed/claimed/completed catalog — Worker blob first, GitHub walk as fallback. */
export async function listListedProposals(): Promise<Proposal[]> {
  if (
    listedCache &&
    listedCache.scope === "listed" &&
    Date.now() - listedCache.at < LISTED_TTL_MS
  ) {
    return listedCache.data;
  }
  const fromWorker = await fetchWorkerCatalog("listed");
  const data =
    fromWorker ||
    (await listProposalsInDirs(["listed", "claimed", "completed"]));
  listedCache = { at: Date.now(), data, scope: "listed" };
  return data;
}

export function clearListedProposalsCache(): void {
  listedCache = null;
}

async function loadProposalByPath(path: string): Promise<Proposal | null> {
  const normalized = path.replace(/^\//, "");
  try {
    const raw = await fetch(`${PROPOSALS_RAW}/${normalized}`);
    if (!raw.ok) return null;
    const dir = normalized.split("/")[1] || "unknown";
    return proposalFromMarkdown(await raw.text(), normalized, dir);
  } catch {
    return null;
  }
}

export async function findListedProposalById(
  id: string,
): Promise<Proposal | null> {
  const normalized = id.trim();
  if (!normalized) return null;

  // Prefer Worker id→path index (O(1)); fall back to GitHub directory walk.
  // Lookup returns 200 with path:null when missing (avoids console 404 noise).
  if (WORKERS_API) {
    try {
      const res = await fetch(
        `${WORKERS_API.replace(/\/$/, "")}/proposals/lookup/${encodeURIComponent(normalized)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          path?: string | null;
          found?: boolean;
        };
        if (data.path) {
          const hit = await loadProposalByPath(data.path);
          if (hit) return hit;
        }
      }
    } catch {
      /* fall through */
    }
  }

  const proposals = await listListedProposals();
  const needle = normalized.toLowerCase();
  return (
    proposals.find(
      (proposal) =>
        proposal.id?.toLowerCase() === needle || proposal.path === normalized,
    ) || null
  );
}

export async function listAllPublicProposals(): Promise<Proposal[]> {
  if (
    listedCache &&
    listedCache.scope === "all" &&
    Date.now() - listedCache.at < LISTED_TTL_MS
  ) {
    return listedCache.data;
  }
  const fromWorker = await fetchWorkerCatalog("all");
  const data =
    fromWorker ||
    (await listProposalsInDirs([
      "listed",
      "claimed",
      "completed",
      "unindexed",
      "declined",
    ]));
  listedCache = { at: Date.now(), data, scope: "all" };
  return data;
}

export function proposalsForProfile(
  proposals: Proposal[],
  profile: { username?: string; github?: string },
): Proposal[] {
  const username = profile.username?.toLowerCase();
  const github = profile.github?.toLowerCase();
  return proposals.filter((p) => {
    const claimer = p.claimer?.toLowerCase();
    if (username && claimer === username) return true;
    if (github && claimer === github) return true;
    const proposer = p.proposer;
    if (!proposer) return false;
    if (username && proposer.username?.toLowerCase() === username) return true;
    if (github && proposer.github?.toLowerCase() === github) return true;
    return false;
  });
}
