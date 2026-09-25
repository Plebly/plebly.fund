import type { Proposal } from "./types";
import { escapeHtml, html } from "./util";

const CLOSED_OUTCOME: Record<string, string> = {
  completed: "Shipped",
  declined: "Declined",
  declined_fundable: "Declined",
  underfunded: "Underfunded",
  refunding: "Refunding",
  redirected: "Redirected",
};

/** One muted sentence under the title when the public status is closed. */
export function projectOutcomeHtml(
  status: string,
  shippedBy?: string | null,
): string {
  const label = CLOSED_OUTCOME[String(status || "").toLowerCase()];
  if (!label) return "";
  const login = String(shippedBy || "").replace(/^@/, "").trim();
  const text =
    label === "Shipped" && login ? `Shipped by @${login}.` : `${label}.`;
  return html`<p class="proposal-outcome muted" id="proposal-outcome">${text}</p>`.value;
}

export function statusLabel(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "listed") return "Listed — still raising";
  if (s === "claimable") return "Claimable";
  if (s === "in_review") return "In review";
  return String(status || "").replace(/_/g, " ");
}

export function statusClass(status: string): string {
  if (["listed", "claimable", "completed"].includes(status)) return "status-good";
  if (
    ["claimed", "in_review", "funding", "abandoned_vote", "underfunded"].includes(
      status,
    )
  ) {
    return "status-active";
  }
  if (
    ["declined", "rejected", "refunding", "redirected", "redirect_pending"].includes(
      status,
    )
  ) {
    return "status-bad";
  }
  return "status-neutral";
}

/** Status pill for cards/hero — same canonical labels as filters. */
export function statusPillHtml(status: string): string {
  const s = String(status || "").toLowerCase();
  if (!s) return "";
  return html`<span class="pill pill-status ${statusClass(s)}">${statusLabel(s)}</span>`.value;
}

export type ProposalStep =
  | "List"
  | "Fund"
  | "Award"
  | "Build"
  | "Review"
  | "Rebuttal"
  | "Release";

export function proposalCurrentStep(p: Proposal): ProposalStep {
  const status = String(p.status || "");
  const isDirect = String(p.proposal_type || "bounty") === "direct";
  if (p.release_blocked_reason) return "Release";
  if (status === "completed") return "Release";
  if (status === "rejected") return "Rebuttal";
  if (status === "in_review") return "Review";
  if (status === "claimed") return "Build";
  if (status === "claimable" || status === "listed" || status === "funding") {
    if (isDirect) return "Fund";
    if (status === "claimable") return "Award";
    return "Fund";
  }
  if (status === "unindexed" || status === "pr_open") return "List";
  return "List";
}

export function proposalStepperHtml(p: Proposal): string {
  const isDirect = String(p.proposal_type || "bounty") === "direct";
  const current = proposalCurrentStep(p);
  const steps: ProposalStep[] = isDirect
    ? ["List", "Fund", "Build", "Review", "Release"]
    : ["List", "Fund", "Award", "Build", "Review", "Release"];
  if (current === "Rebuttal" && !steps.includes("Rebuttal")) {
    const i = steps.indexOf("Review");
    steps.splice(i + 1, 0, "Rebuttal");
  }
  const currentIdx = steps.indexOf(current === "Rebuttal" ? "Rebuttal" : current);
  const items = steps.map((step, i) => {
    const state = i === currentIdx ? "current" : i < currentIdx ? "done" : "todo";
    return state === "current"
      ? html`<li class="proposal-step proposal-step-${state}" aria-current="step">${step}</li>`
      : html`<li class="proposal-step proposal-step-${state}">${step}</li>`;
  });
  return html`<ol class="proposal-stepper" aria-label="Project path">${items}</ol>`.value;
}
