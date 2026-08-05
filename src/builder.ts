import {
  CLAIM_BOND_SATS,
  CLAIM_FLOOR_SATS,
  WORKERS_API,
} from "./config";
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
    claim_bond_txid?: string;
    created_at: string;
  } | null;
  claimer?: string | null;
  claimed_at?: string | null;
  payout_address?: string | null;
  status?: string;
  title?: string;
  claim_bond_txid?: string | null;
  claim_bond_sats?: number;
  checkpoint_due_at?: string | null;
  checkpoint_grace_ends_at?: string | null;
  checkpoint_url?: string | null;
  claim_window_ends_at?: string | null;
  proposer_claimed?: boolean;
  claimer_summary?: {
    active: number;
    completed: number;
    expired: number;
    rejected: number;
    abandoned: number;
  } | null;
};

export type ClaimLedgerView = {
  active: string[];
  history: { proposal_id: string; outcome: string; at: string }[];
  cooldowns: { proposal_id: string; until: string; reason: string }[];
  bonds: {
    proposal_id: string;
    txid: string;
    amount_sats: number;
    status: string;
  }[];
  checkpoints: { proposal_id: string; url: string; at: string }[];
  required_bond_sats: number;
  summary: {
    active: number;
    completed: number;
    expired: number;
    rejected: number;
    abandoned: number;
  };
};

export type ClaimParams = {
  claim_bond_sats: number;
  max_active_claims: number;
  reclaim_cooldown_days: number;
  checkpoint_day: number;
  checkpoint_grace_days: number;
  fee_address: string | null;
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

export function isDirectProposal(p: Proposal): boolean {
  return String(p.proposal_type || "bounty").toLowerCase() === "direct";
}

export function isOpenToClaim(p: Proposal, floor = CLAIM_FLOOR_SATS): boolean {
  if (isDirectProposal(p)) return false;
  const status = String(p.status);
  if (isTakenStatus(status) || p.claimer) return false;
  if (!CLAIMABLE_STATUSES.has(status)) return false;
  return (p.balance_sats ?? 0) >= floor;
}

export function isNearFloor(p: Proposal, floor = CLAIM_FLOOR_SATS): boolean {
  if (isDirectProposal(p)) return false;
  const status = String(p.status);
  if (isTakenStatus(status) || p.claimer) return false;
  if (!CLAIMABLE_STATUSES.has(status)) return false;
  const bal = p.balance_sats ?? 0;
  return bal >= floor * 0.5 && bal < floor;
}

/** Open (not taken) projects still below the claim floor. */
export function claimFloorShortfall(
  proposals: Proposal[],
  floor = CLAIM_FLOOR_SATS,
): { shortfallSats: number; projectCount: number; fundedTowardFloor: number } {
  let shortfallSats = 0;
  let projectCount = 0;
  let fundedTowardFloor = 0;
  for (const p of proposals) {
    const status = String(p.status);
    if (status === "completed") continue;
    if (isTakenStatus(status) || p.claimer) continue;
    const bal = Math.max(0, p.balance_sats ?? 0);
    const need = Math.max(0, floor - bal);
    if (need <= 0) continue;
    shortfallSats += need;
    fundedTowardFloor += Math.min(bal, floor);
    projectCount += 1;
  }
  return { shortfallSats, projectCount, fundedTowardFloor };
}

export async function fetchWatches(): Promise<WatchEntry[]> {
  if (!WORKERS_API) return [];
  // Guests have no session — skip the guaranteed 401 instead of blocking the page.
  try {
    if (!sessionStorage.getItem("plebly_session")) return [];
  } catch {
    return [];
  }
  const res = await fetch(`${API()}/watch`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { watches?: WatchEntry[] };
  return data.watches || [];
}

/** Path basename — matches Workers watchmeta / watchers keys. */
export function watchStorageId(pathOrId: string): string {
  const raw = pathOrId.trim();
  if (!raw) return "";
  return raw.replace(/\.md$/i, "").split("/").filter(Boolean).pop() || raw;
}

export async function fetchWatchMetaBatch(
  ids: string[],
): Promise<Record<string, { count: number; weighted: number }>> {
  if (!WORKERS_API || !ids.length) return {};
  const q = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    .slice(0, 100)
    .map(encodeURIComponent)
    .join(",");
  const res = await fetch(`${API()}/watch/meta?ids=${q}`);
  if (!res.ok) return {};
  const data = (await res.json()) as {
    meta?: Record<string, { count?: number; weighted?: number }>;
  };
  const out: Record<string, { count: number; weighted: number }> = {};
  for (const [id, m] of Object.entries(data.meta || {})) {
    out[id] = {
      count: Math.max(0, Number(m.count) || 0),
      weighted: Math.max(0, Number(m.weighted) || 0),
    };
  }
  return out;
}

export type WantedRow = {
  id: string | null;
  path: string;
  title: string;
  status: string;
  watches: number;
  weighted: number;
  funded_pct: number | null;
  balance_sats: number | null;
  target_sats: number | null;
  cover_image: string | null;
  excerpt: string;
};

export async function fetchWanted(limit = 12): Promise<WantedRow[]> {
  if (!WORKERS_API) return [];
  const res = await fetch(`${API()}/wanted?limit=${limit}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { proposals?: WantedRow[] };
  return Array.isArray(data.proposals) ? data.proposals : [];
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

export async function fetchClaimParams(): Promise<ClaimParams> {
  if (!WORKERS_API) {
    return {
      claim_bond_sats: CLAIM_BOND_SATS,
      max_active_claims: 1,
      reclaim_cooldown_days: 30,
      checkpoint_day: 45,
      checkpoint_grace_days: 7,
      fee_address: null,
    };
  }
  const res = await fetch(`${API()}/claims/params`);
  if (!res.ok) {
    return {
      claim_bond_sats: CLAIM_BOND_SATS,
      max_active_claims: 1,
      reclaim_cooldown_days: 30,
      checkpoint_day: 45,
      checkpoint_grace_days: 7,
      fee_address: null,
    };
  }
  return (await res.json()) as ClaimParams;
}

export async function fetchMyClaims(): Promise<{
  pending: {
    user_id: string;
    proposal_id: string;
    proposal_path: string;
    pr_url?: string;
    payout_address: string;
    claim_bond_txid?: string;
    created_at: string;
  }[];
  ledger: ClaimLedgerView | null;
}> {
  if (!WORKERS_API) return { pending: [], ledger: null };
  const res = await fetch(`${API()}/claims/mine`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) return { pending: [], ledger: null };
  const data = (await res.json()) as {
    pending?: {
      user_id: string;
      proposal_id: string;
      proposal_path: string;
      pr_url?: string;
      payout_address: string;
      claim_bond_txid?: string;
      created_at: string;
    }[];
    ledger?: ClaimLedgerView;
  };
  return { pending: data.pending || [], ledger: data.ledger || null };
}

export async function fetchMyPendingClaims(): Promise<
  NonNullable<
    ClaimStatus["pending"] & { proposal_id: string; proposal_path: string }
  >[]
> {
  const { pending } = await fetchMyClaims();
  return pending;
}

export async function submitClaim(input: {
  proposal_path: string;
  payout_address: string;
  note?: string;
  claim_bond_txid: string;
}): Promise<{ pr_url: string; proposal_id: string; bond_sats?: number }> {
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
    bond_sats?: number;
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
  return {
    pr_url: data.pr_url,
    proposal_id: data.proposal_id || "",
    bond_sats: data.bond_sats,
  };
}

export async function submitCheckpoint(input: {
  proposal_path: string;
  url: string;
}): Promise<void> {
  const res = await fetch(`${API()}/claims/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok) throw new Error(data.error || `Checkpoint failed (${res.status})`);
}

export async function submitAbandonedChallenge(input: {
  proposal_path: string;
  reason?: string;
}): Promise<{ pr_url?: string }> {
  const res = await fetch(`${API()}/claims/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    challenge?: { pr_url?: string };
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok) throw new Error(data.error || `Challenge failed (${res.status})`);
  return { pr_url: data.challenge?.pr_url };
}

export type DeliverableResult = {
  pr_url: string;
  decision_id?: string;
  ai_review?: {
    outcome: "pass" | "fail" | "ambiguous";
    reasoning: string;
    failing_criteria?: string[];
    prompt_version: string;
    model: string;
  };
};

export async function submitDeliverable(input: {
  proposal_path: string;
  deliverable_url: string;
  description: string;
  artifact_hash?: string;
}): Promise<DeliverableResult> {
  const res = await fetch(`${API()}/deliverables`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as DeliverableResult & { error?: string };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.pr_url) {
    throw new Error(data.error || `Deliverable failed (${res.status})`);
  }
  return {
    pr_url: data.pr_url,
    decision_id: data.decision_id,
    ai_review: data.ai_review,
  };
}

/** Prefer claim_window_ends_at (includes granted extensions). */
export function claimWindowDaysLeft(
  claimedAtOrEnd: string | null | undefined,
  endsAt?: string | null,
): number | null {
  const endIso = endsAt || claimedAtOrEnd;
  if (!endIso) return null;
  const end = new Date(endIso).getTime();
  if (Number.isNaN(end)) return null;
  // Legacy: if only claimed_at was passed (no endsAt), keep 90-day window from start
  if (!endsAt && claimedAtOrEnd) {
    const start = new Date(claimedAtOrEnd).getTime();
    if (Number.isNaN(start)) return null;
    const legacyEnd = start + 90 * 24 * 60 * 60 * 1000;
    return Math.ceil((legacyEnd - Date.now()) / (24 * 60 * 60 * 1000));
  }
  return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
}

export async function requestClaimExtension(input: {
  proposal_path: string;
}): Promise<{ decision_id: string }> {
  const res = await fetch(`${API()}/reviewers/decisions/request-extension`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    decision?: { id: string };
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.decision?.id) {
    throw new Error(data.error || `Extension request failed (${res.status})`);
  }
  return { decision_id: data.decision.id };
}
