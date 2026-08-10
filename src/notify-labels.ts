import { href, proposalHref } from "./router";

/** Shared notification titles for nav dropdown + Account. */
export function notificationTypeLabel(
  type: string,
  payload?: { needs_address?: boolean; needs_refund_address?: boolean } | null,
): string {
  const needsRefund =
    Boolean(payload?.needs_address) || Boolean(payload?.needs_refund_address);
  if (type === "bond_refundable" && needsRefund) {
    return "Bond refundable — set refund address in Funds";
  }
  const labels: Record<string, string> = {
    listed: "Project listed",
    floor_reached: "Claim floor reached",
    target_reached: "Funding target reached",
    claimed: "Project claimed",
    claim_application: "Bonded applicant",
    claim_application_awarded: "Claim awarded to you",
    claim_application_rejected: "Application rejected",
    claim_application_lost: "Another applicant won",
    workboard_message: "New workboard message",
    claim_window_grace: "Pick an applicant (grace)",
    claim_auto_awarded: "Auto-awarded earliest bond",
    checkpoint_submitted: "Checkpoint submitted",
    deliverable_submitted: "Deliverable submitted",
    completed: "Project completed",
    bond_refundable: "Bond refundable — check Funds",
    bond_refunded: "Bond refunded",
    bond_forfeited: "Bond forfeited",
    refund_registered: "Refund address registered",
    contrib_refunded: "Contribution refunded",
    release_queued: "Escrow release queued",
    release_broadcast: "Escrow release broadcast",
    disburse_chat: "Keyholder coordination message",
    redirect_pending: "Redirect pending (ops)",
    platform_config_ballot_opened: "Config change vote opened",
    platform_config_ballot_vote: "Config ballot vote updated",
    platform_config_ballot_passed: "Config change approved",
    platform_config_ballot_rejected: "Config change rejected",
    platform_config_ballot_expired: "Config ballot expired",
    platform_config_ballot_withdrawn: "Config ballot withdrawn",
  };
  return (
    labels[type] ||
    type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** Where a notification should land in the SPA. */
export function notificationTargetHref(n: {
  type: string;
  proposal_id?: string;
  proposal_path?: string;
}): string {
  if (n.type === "bond_refundable" || n.type === "bond_refunded") {
    return href("/account", "?tab=funds");
  }
  if (String(n.type || "").startsWith("platform_config_ballot_")) {
    const path = (n.proposal_path || "").trim();
    if (path.startsWith("/admin")) return href(path.split("?")[0] || "/admin", path.includes("?") ? `?${path.split("?")[1]}` : "");
    return href("/admin", "?tab=votes");
  }
  if (n.proposal_path || n.proposal_id) {
    return proposalHref(n.proposal_path || "", n.proposal_id || "");
  }
  return href("/account", "?tab=notifications");
}
