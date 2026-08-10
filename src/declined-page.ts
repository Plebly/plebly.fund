import type { Proposal } from "./types";

function isDeclinedStatus(status: string | undefined): boolean {
  return status === "declined" || status === "declined_fundable";
}

export function filterDeclinedProposals(proposals: Proposal[]): Proposal[] {
  return proposals
    .filter((p) => isDeclinedStatus(p.status) || p.path.includes("/declined/"))
    .sort((a, b) => (b.id || "").localeCompare(a.id || ""));
}
