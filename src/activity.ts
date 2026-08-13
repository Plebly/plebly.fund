import { WORKERS_API } from "./config";
import { proposalHref } from "./router";
import { escapeHtml, timeAgoHtml } from "./util";

type ActivityEvent = {
  type?: string;
  proposal_id?: string;
  proposal_path?: string;
  created_at?: string;
};

export const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  listed: "Listed",
  floor_reached: "Open to apply",
  target_reached: "Target reached",
  claimed: "Claimed",
  deliverable_submitted: "Deliverable submitted",
  completed: "Completed",
};

export function eventLabel(type: string | undefined): string {
  if (!type) return "Updated";
  return (
    ACTIVITY_EVENT_LABELS[type] ||
    type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

export async function bindActivityStrip(root: ParentNode): Promise<void> {
  const strip = root.querySelector<HTMLElement>("#activity-strip");
  if (!strip || !WORKERS_API) return;
  try {
    const res = await fetch(`${WORKERS_API.replace(/\/$/, "")}/events`);
    if (!res.ok) return;
    const data = (await res.json()) as { events?: ActivityEvent[] } | ActivityEvent[];
    const events = Array.isArray(data) ? data : data.events || [];
    const visible = events.filter((event) => event.proposal_id).slice(0, 5);
    if (!visible.length) return;
    strip.innerHTML = `<span class="activity-strip-label">Recent</span>
      <ul>${visible
        .map((event) => {
          const when = timeAgoHtml(event.created_at);
          const id = event.proposal_id || "";
          const shortId =
            id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
          return `<li><a href="${proposalHref(event.proposal_path || "", event.proposal_id)}"><span class="activity-event">${escapeHtml(eventLabel(event.type))}</span><span class="mono activity-id" title="${escapeHtml(id)}">${escapeHtml(shortId)}</span>${when ? `<span class="activity-strip-date">${when}</span>` : ""}</a></li>`;
        })
        .join("")}</ul>`;
    strip.hidden = false;
  } catch {
    // Activity is optional; preserve the quiet landing page if it is unavailable.
  }
}
