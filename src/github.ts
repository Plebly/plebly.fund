import { PROPOSALS_API, PROPOSALS_RAW } from "./config";
import type { Proposal, ProposalMilestone, ProposalProposer } from "./types";

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

export function parseFrontMatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const fm = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).trim();
  const data: Record<string, unknown> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let value: unknown = line.slice(i + 1).trim();
    if (value === "null") value = null;
    else if (value === "[]") value = [];
    else if (
      typeof value === "string" &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1);
    } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
      value = Number(value);
    } else if (typeof value === "string" && value.startsWith("{")) {
      try {
        value = JSON.parse(value);
      } catch {
        /* keep string */
      }
    }
    data[key] = value;
  }
  return { data, body };
}

function parseProposer(data: Record<string, unknown>): ProposalProposer | null {
  const p = data.proposer;
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  return {
    github: (o.github as string) || null,
    username: (o.username as string) || null,
    nostr: (o.nostr as string) || null,
  };
}

export function proposalFromMarkdown(raw: string, path: string, dir = "unknown"): Proposal {
  const { data, body } = parseFrontMatter(raw);
  return {
    id: (data.id as string) || path.replace(/\.md$/, "").split("/").pop() || null,
    title: (data.title as string) || path,
    status: (data.status as string) || dir,
    path,
    target_sats: typeof data.target_sats === "number" ? data.target_sats : null,
    escrow_address: (data.escrow_address as string) || null,
    submission_fee_txid: (data.submission_fee_txid as string) || null,
    cover_image: (data.cover_image as string) || null,
    created_at: (data.created_at as string) || null,
    escrow_index: typeof data.escrow_index === "number" ? data.escrow_index : null,
    milestones: parseMilestones(data.milestones),
    proposer: parseProposer(data),
    claimer: (data.claimer as string) || null,
    claimed_at: (data.claimed_at as string) || null,
    payout_address: (data.payout_address as string) || null,
    deliverable_url: (data.deliverable_url as string) || null,
    escrow_allocated_at: (data.escrow_allocated_at as string) || null,
    funding_window_ends_at: (data.funding_window_ends_at as string) || null,
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
