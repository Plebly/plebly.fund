import { WORKERS_API } from "./config";

type ViewResponse = { view_count?: number };
type BatchResponse = { counts?: Record<string, number> };

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

/** One request for many proposal view counts (home page). */
export async function fetchProposalViewsBatch(
  proposalIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(proposalIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length || !WORKERS_API) return out;
  const url = `${WORKERS_API.replace(/\/$/, "")}/views?ids=${ids
    .map((id) => encodeURIComponent(id))
    .join(",")}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return out;
    const data = (await response.json()) as BatchResponse;
    for (const [id, count] of Object.entries(data.counts || {})) {
      if (typeof count === "number") out.set(id, count);
    }
  } catch {
    /* optional enrichment */
  }
  return out;
}

export function recordProposalView(proposalId: string): Promise<number | null> {
  return requestViews(proposalId, "POST");
}
