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
  return value.filter(
    (m): m is ProposalMilestone =>
      !!m && typeof m === "object" && "deliverable" in m,
  );
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
    for (const item of items) {
      const p = await loadProposalFile(item, dir);
      if (p) out.push(p);
    }
  }
  return out;
}

export async function listListedProposals(): Promise<Proposal[]> {
  return listProposalsInDirs(["listed", "claimed", "completed"]);
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
  if (WORKERS_API) {
    try {
      const res = await fetch(
        `${WORKERS_API.replace(/\/$/, "")}/proposals/lookup/${encodeURIComponent(normalized)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { path?: string };
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
  return proposals.find((proposal) => proposal.id === normalized) || null;
}

export async function listAllPublicProposals(): Promise<Proposal[]> {
  return listProposalsInDirs([
    "listed",
    "claimed",
    "completed",
    "unindexed",
    "declined",
  ]);
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
