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

export type OpsRoleKind = "triage_steward" | "incident_scribe" | "comms";

export type OpsRoleView = {
  user_id: string;
  role: string;
  kind?: string;
  label?: string;
  source: string;
  term_ends_at?: string;
  seated_at?: string;
  holder?: string;
};

export type OpsRoleBallotView = {
  id: string;
  kind: string;
  action: "grant" | "remove" | "retain";
  nominee_user_id: string;
  initiator_user_id: string;
  rationale: string;
  created_at: string;
  closes_at: string;
  status: string;
  passed?: boolean;
  vote_count: number;
  counts: { yes: number; no: number };
  roster_size?: number;
  need_yes?: number;
};

export type OpsRolesGate = {
  open: boolean;
  completions: number;
  min_completions: number;
  reviewers: number;
  min_reviewers: number;
  reason: string;
};

export type OpsRolesPayload = {
  roles: OpsRoleView[];
  count: number;
  kinds: string[];
  gate: OpsRolesGate;
  ballots: OpsRoleBallotView[];
};

export async function fetchOpsRoles(): Promise<OpsRolesPayload | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(`${API()}/ops/roles`);
  if (!res.ok) return null;
  return (await res.json()) as OpsRolesPayload;
}

export async function nominateOpsRole(input: {
  kind: string;
  action: "grant" | "remove" | "retain";
  nominee_user_id: string;
  rationale: string;
}): Promise<OpsRoleBallotView> {
  const res = await fetch(`${API()}/ops/roles/nominate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ballot?: OpsRoleBallotView;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.ballot) {
    throw new Error(data.error || `Nominate failed (${res.status})`);
  }
  return data.ballot;
}

export async function voteOpsRoleBallot(
  ballotId: string,
  vote: "yes" | "no",
): Promise<OpsRoleBallotView> {
  const res = await fetch(
    `${API()}/ops/roles/ballots/${encodeURIComponent(ballotId)}/vote`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ vote }),
    },
  );
  const data = (await res.json()) as {
    ballot?: OpsRoleBallotView;
    error?: string;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.ballot) {
    throw new Error(data.error || `Ops role vote failed (${res.status})`);
  }
  return data.ballot;
}

export function opsRoleLabel(kind: string): string {
  if (kind === "triage_steward") return "Triage steward";
  if (kind === "incident_scribe") return "Incident scribe";
  if (kind === "comms") return "Comms";
  if (kind === "bootstrap") return "Bootstrap ops";
  return kind;
}

export function opsActionLabel(action: string): string {
  if (action === "grant") return "Grant";
  if (action === "remove") return "Remove";
  if (action === "retain") return "Retain";
  return action;
}
