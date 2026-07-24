import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import type { Proposal } from "./types";

const API = () => WORKERS_API.replace(/\/$/, "");

export type WatchEntry = {
  proposal_id: string;
  proposal_path: string;
  watched_at: string;
};

export type ClaimStatus = {
  proposal_id: string;
  proposal_path: string;
  state:
    | "open"
    | "below_floor"
    | "claim_pending"
    | "claimed"
    | "in_review"
    | "completed"
    | "unavailable";
  confirmed_balance_sats: number | null;
  claim_floor_sats: number;
  pending?: {
    user_id: string;
    pr_url?: string;
    payout_address: string;
    created_at: string;
  } | null;
  claimer?: string | null;
  claimed_at?: string | null;
  payout_address?: string | null;
  status?: string;
  title?: string;
};

const CLAIMABLE_STATUSES = new Set(["listed", "funding", "claimable"]);
const TAKEN_STATUSES = new Set(["claimed", "in_review", "rejected"]);

function authHeaders(): HeadersInit {
  try {
    const token = sessionStorage.getItem("plebly_session");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export function isTakenStatus(status: string): boolean {
  return TAKEN_STATUSES.has(status);
}

export function isOpenToClaim(p: Proposal, floor = CLAIM_FLOOR_SATS): boolean {
  const status = String(p.status);
  if (isTakenStatus(status) || p.claimer) return false;
  if (!CLAIMABLE_STATUSES.has(status)) return false;
  return (p.balance_sats ?? 0) >= floor;
}

export function isNearFloor(p: Proposal, floor = CLAIM_FLOOR_SATS): boolean {
  const status = String(p.status);
  if (isTakenStatus(status) || p.claimer) return false;
  if (!CLAIMABLE_STATUSES.has(status)) return false;
  const bal = p.balance_sats ?? 0;
  return bal >= floor * 0.5 && bal < floor;
}

export async function fetchWatches(): Promise<WatchEntry[]> {
  if (!WORKERS_API) return [];
  const res = await fetch(`${API()}/watch`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { watches?: WatchEntry[] };
  return data.watches || [];
}

export async function addWatch(proposalPath: string): Promise<void> {
  const id = proposalPath.replace(/\.md$/, "").split("/").pop() || proposalPath;
  const res = await fetch(`${API()}/watch/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify({ proposal_path: proposalPath }),
  });
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Watch failed (${res.status})`);
  }
}

export async function removeWatch(proposalPath: string): Promise<void> {
  const id = proposalPath.replace(/\.md$/, "").split("/").pop() || proposalPath;
  const res = await fetch(`${API()}/watch/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include",
  });
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Unwatch failed (${res.status})`);
  }
}

export async function fetchClaimStatus(
  proposalPath: string,
): Promise<ClaimStatus | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(
    `${API()}/claims/${encodeURIComponent(proposalPath)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as ClaimStatus;
}

export async function fetchMyPendingClaims(): Promise<
  NonNullable<ClaimStatus["pending"] & { proposal_id: string; proposal_path: string }>[]
> {
  if (!WORKERS_API) return [];
  const res = await fetch(`${API()}/claims/mine`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    pending?: {
      user_id: string;
      proposal_id: string;
      proposal_path: string;
      pr_url?: string;
      payout_address: string;
      created_at: string;
    }[];
  };
  return data.pending || [];
}

export async function submitClaim(input: {
  proposal_path: string;
  payout_address: string;
  note?: string;
}): Promise<{ pr_url: string; proposal_id: string }> {
  const res = await fetch(`${API()}/claims`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    pr_url?: string;
    proposal_id?: string;
    error?: string;
    pending?: { pr_url?: string };
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.pr_url) {
    const hint = data.pending?.pr_url
      ? ` Pending: ${data.pending.pr_url}`
      : "";
    throw new Error((data.error || `Claim failed (${res.status})`) + hint);
  }
  return { pr_url: data.pr_url, proposal_id: data.proposal_id || "" };
}

export async function submitDeliverable(input: {
  proposal_path: string;
  deliverable_url: string;
  description: string;
  artifact_hash?: string;
}): Promise<{ pr_url: string }> {
  const res = await fetch(`${API()}/deliverables`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { pr_url?: string; error?: string };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.pr_url) {
    throw new Error(data.error || `Deliverable failed (${res.status})`);
  }
  return { pr_url: data.pr_url };
}

export function claimWindowDaysLeft(claimedAt: string | null | undefined): number | null {
  if (!claimedAt) return null;
  const start = new Date(claimedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end = start + 90 * 24 * 60 * 60 * 1000;
  return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
}
