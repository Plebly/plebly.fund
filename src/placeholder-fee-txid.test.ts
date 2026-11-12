/** An all-zero submission fee txid is a placeholder: no explorer link or Copy control. */
import { describe, expect, it } from "vitest";
import { onChainPanelHtml } from "./proposal-ui";
import type { Proposal } from "./types";

function row(txid: string | null): Proposal {
  return {
    id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM",
    path: "proposals/listed/PLEBLY-KNOTS-SIZE-VALUE-SPAM.md",
    title: "Knots",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 50_000,
    escrow_address: null,
    submission_fee_txid: txid,
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "",
  } as unknown as Proposal;
}

describe("submission fee txid", () => {
  it("hides an all-zero placeholder txid", () => {
    const html = onChainPanelHtml(row("0".repeat(64)));
    expect(html).not.toContain("0".repeat(64));
    expect(html).not.toContain("Submission fee");
  });

  it("keeps a real txid with its explorer link", () => {
    const tx = "ab".repeat(32);
    const html = onChainPanelHtml(row(tx));
    expect(html).toContain("Submission fee");
    expect(html).toContain(`/tx/${tx}`);
  });
});
