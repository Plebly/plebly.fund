import { WORKERS_API } from "./config";

type ViewResponse = { view_count?: number };

function endpoint(proposalId: string): string | null {
  if (!proposalId || !WORKERS_API) return null;
  return `${WORKERS_API.replace(/\/$/, "")}/views/${encodeURIComponent(proposalId)}`;
}

async function requestViews(proposalId: string, method: "GET" | "POST"): Promise<number | null> {
  const url = endpoint(proposalId);
  if (!url) return null;
  try {
    const response = await fetch(url, { method });
    if (!response.ok) return null;
    const data = (await response.json()) as ViewResponse;
    return typeof data.view_count === "number" ? data.view_count : null;
  } catch {
    return null;
  }
}

export function fetchProposalViews(proposalId: string): Promise<number | null> {
  return requestViews(proposalId, "GET");
}

export function recordProposalView(proposalId: string): Promise<number | null> {
  return requestViews(proposalId, "POST");
}
