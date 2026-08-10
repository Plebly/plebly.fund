import type { Proposal } from "./types";

export function filterCompletedProposals(proposals: Proposal[]): Proposal[] {
  return proposals
    .filter(
      (p) =>
        String(p.status) === "completed" || p.path.includes("/completed/"),
    )
    .sort((a, b) => (b.id || "").localeCompare(a.id || ""));
}
