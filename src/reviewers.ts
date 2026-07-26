import { WORKERS_API } from "./config";

const API = () => WORKERS_API.replace(/\/$/, "");

function authHeaders(): HeadersInit {
  try {
    const token = sessionStorage.getItem("plebly_session");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export type AiReviewView = {
  outcome: "pass" | "fail" | "ambiguous";
  reasoning: string;
  failing_criteria?: string[];
  prompt_version: string;
  model: string;
};

export type ReviewDecisionView = {
  id: string;
  proposal_id: string;
  proposal_path?: string;
  kind: string;
  round: number;
  created_at: string;
  closes_at: string;
  status: string;
  counts: { yes: number; no: number; abstain: number };
  vote_count: number;
  passed?: boolean;
  result?: string;
  roster_size?: number;
  need_yes?: number;
  ai_review?: AiReviewView;
  dissent?: { user_id: string; at: string; reasoning: string; pr_url?: string }[];
};

export type ReviewerPublic = {
  user_id: string;
  kind: "bootstrap" | "earned";
  status: string;
  seated_at: string;
  completed_count: number;
  completed_proposal_ids: string[];
};

export type ReviewerMe = {
  active: boolean;
  funder_eligible?: boolean;
  removal_min_sats?: number;
  reviewer: ReviewerPublic | null;
};

export type RemovalBallotView = {
  id: string;
  target_user_id: string;
  initiator_user_id: string;
  evidence: string;
  created_at: string;
  closes_at: string;
  status: string;
  passed?: boolean;
  eligible_count?: number;
  vote_count: number;
  counts: { yes: number; no: number };
  evidence_pr_url?: string;
  result_pr_url?: string;
};

export type ReviewerRoster = {
  active: string[];
  reviewers: ReviewerPublic[];
  count: number;
  platform_completions: number;
};

export async function fetchReviewerRoster(): Promise<ReviewerRoster | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(`${API()}/reviewers`);
  if (!res.ok) return null;
  return (await res.json()) as ReviewerRoster;
}

export async function fetchOpenReviewDecisions(): Promise<ReviewDecisionView[]> {
  if (!WORKERS_API) return [];
  const res = await fetch(`${API()}/reviewers/decisions/open`);
  if (!res.ok) return [];
  const data = (await res.json()) as { decisions?: ReviewDecisionView[] };
  return data.decisions || [];
}

export async function fetchOpenRemovalBallots(): Promise<RemovalBallotView[]> {
  if (!WORKERS_API) return [];
  const res = await fetch(`${API()}/reviewers/removals`);
  if (!res.ok) return [];
  const data = (await res.json()) as { ballots?: RemovalBallotView[] };
  return data.ballots || [];
}

export async function fetchOpenReviewDecision(
  proposalId: string,
): Promise<ReviewDecisionView | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(
    `${API()}/reviewers/decisions/proposal/${encodeURIComponent(proposalId)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { decision: ReviewDecisionView | null };
  return data.decision;
}

export async function voteReviewDecision(
  decisionId: string,
  vote: "yes" | "no" | "abstain",
): Promise<ReviewDecisionView> {
  const res = await fetch(
    `${API()}/reviewers/decisions/${encodeURIComponent(decisionId)}/vote`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ vote }),
    },
  );
  const data = (await res.json()) as {
    decision?: ReviewDecisionView;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.decision) {
    throw new Error(data.error || `Vote failed (${res.status})`);
  }
  return data.decision;
}

export async function publishDissent(
  decisionId: string,
  reasoning: string,
): Promise<{ pr_url: string }> {
  const res = await fetch(
    `${API()}/reviewers/decisions/${encodeURIComponent(decisionId)}/dissent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ reasoning }),
    },
  );
  const data = (await res.json()) as { pr_url?: string; error?: string };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.pr_url) {
    throw new Error(data.error || `Dissent failed (${res.status})`);
  }
  return { pr_url: data.pr_url };
}

export async function submitRebuttal(input: {
  proposal_id: string;
  proposal_path: string;
  reasoning: string;
}): Promise<{ pr_url: string; decision_id: string }> {
  const res = await fetch(`${API()}/claims/rebuttal`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    pr_url?: string;
    decision_id?: string;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.pr_url) {
    throw new Error(data.error || `Rebuttal failed (${res.status})`);
  }
  return { pr_url: data.pr_url, decision_id: data.decision_id || "" };
}

export async function fetchReviewerMe(): Promise<ReviewerMe | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(`${API()}/reviewers/me`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return (await res.json()) as ReviewerMe;
}

export async function openListingChallenge(input: {
  proposal_path: string;
  rationale: string;
}): Promise<ReviewDecisionView> {
  const res = await fetch(`${API()}/reviewers/decisions/challenge-listing`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    decision?: ReviewDecisionView;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.decision) {
    throw new Error(data.error || `Listing challenge failed (${res.status})`);
  }
  return data.decision;
}

export async function openRemovalBallot(input: {
  target_user_id: string;
  evidence: string;
}): Promise<RemovalBallotView> {
  const res = await fetch(`${API()}/reviewers/removals/open`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ballot?: RemovalBallotView;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.ballot) {
    throw new Error(data.error || `Open removal failed (${res.status})`);
  }
  return data.ballot;
}

export async function voteRemovalBallot(
  ballotId: string,
  vote: "yes" | "no",
): Promise<RemovalBallotView> {
  const res = await fetch(
    `${API()}/reviewers/removals/${encodeURIComponent(ballotId)}/vote`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ vote }),
    },
  );
  const data = (await res.json()) as {
    ballot?: RemovalBallotView;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.ballot) {
    throw new Error(data.error || `Removal vote failed (${res.status})`);
  }
  return data.ballot;
}

export function decisionKindLabel(kind: string): string {
  if (kind === "deliverable_confirm") return "Deliverable confirm";
  if (kind === "second_review") return "Second review";
  if (kind === "claim_extension") return "Claim extension";
  if (kind === "listing_challenge") return "Listing challenge";
  return kind;
}

export function shortUserId(userId: string): string {
  if (userId.startsWith("github:")) return `gh:${userId.slice(7)}`;
  if (userId.startsWith("x:")) return `x:${userId.slice(2)}`;
  if (userId.length > 22) return `${userId.slice(0, 18)}…`;
  return userId;
}
