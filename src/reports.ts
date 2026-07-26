import { authFetch } from "./auth";
import { WORKERS_API } from "./config";

const api = () => WORKERS_API.replace(/\/$/, "");

export type ModerationReportView = {
  id: string;
  target_type: "listing" | "comment";
  proposal_id: string;
  proposal_path?: string;
  comment_id?: string;
  reason: string;
  escalate_requested: boolean;
  status: string;
  decision_id?: string;
  created_at: string;
  updated_at?: string;
  resolve_note?: string;
};

export async function fileModerationReport(input: {
  target_type: "listing" | "comment";
  proposal_id: string;
  proposal_path?: string;
  comment_id?: string;
  reason: string;
  escalate?: boolean;
}): Promise<{
  report_id: string;
  queue: string;
  decision_id?: string;
  comment_hidden?: boolean;
}> {
  const res = await authFetch(`${api()}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    report_id?: string;
    queue?: string;
    decision_id?: string;
    comment_hidden?: boolean;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.report_id) {
    throw new Error(data.error || `Report failed (${res.status})`);
  }
  return {
    report_id: data.report_id,
    queue: data.queue || "moderation",
    decision_id: data.decision_id,
    comment_hidden: data.comment_hidden,
  };
}

export async function fetchOpenReports(): Promise<ModerationReportView[]> {
  if (!WORKERS_API) return [];
  const res = await authFetch(`${api()}/reports?limit=50`);
  if (res.status === 401 || res.status === 403) return [];
  if (!res.ok) return [];
  const data = (await res.json()) as { reports?: ModerationReportView[] };
  return data.reports || [];
}

export async function resolveModerationReport(
  reportId: string,
  action: "dismiss" | "escalate_listing" | "hide_comment",
  note?: string,
): Promise<ModerationReportView> {
  const res = await authFetch(
    `${api()}/reports/${encodeURIComponent(reportId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    report?: ModerationReportView;
  };
  if (res.status === 401) throw new Error("login_required");
  if (!res.ok || !data.report) {
    throw new Error(data.error || `Resolve failed (${res.status})`);
  }
  return data.report;
}
