// One wording per closed page: the next card and the Donate-slot note
// (donate-closed-note.ts) use the same status groups and copy (UI UX).
import { describe, expect, it } from "vitest";
import type { ClaimStatus } from "./builder";
import {
  DONATE_CLOSED_COMPLETE,
  DONATE_CLOSED_OTHER,
  DONATE_PAUSED_LINE,
  donateClosedReason,
} from "./donate-closed-note";
import { notAcceptingFunds, resolveNextAction } from "./next-action";
import { DONATE_PAUSED_LINE as MODAL_PAUSED_LINE } from "./proposal-ui";
import type { Proposal } from "./types";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "PLEBLY-X",
    path: "proposals/listed/PLEBLY-X.md",
    title: "X",
    status: "listed",
    target_sats: 100_000,
    escrow_address: "tb1qtest",
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 0,
    proposal_type: "bounty",
    ...partial,
  } as Proposal;
}

function claim(partial: Partial<ClaimStatus> = {}): ClaimStatus {
  return {
    proposal_id: "PLEBLY-X",
    proposal_path: "proposals/listed/PLEBLY-X.md",
    state: "unavailable",
    confirmed_balance_sats: 0,
    claim_floor_sats: 10_000,
    accepting_funds: false,
    ...partial,
  } as ClaimStatus;
}

const GROUPS: [string, string[]][] = [
  [DONATE_CLOSED_COMPLETE, ["in_review", "claimed", "completed", "bounty_settled"]],
  [DONATE_CLOSED_OTHER, ["declined", "rejected", "voided", "refunding", "underfunded", "frobnicated"]],
  [DONATE_PAUSED_LINE, ["listed", "funding", "claimable", "declined_fundable"]],
];

describe("next card and Donate-slot note: same string per group", () => {
  for (const [copy, statuses] of GROUPS) {
    for (const status of statuses) {
      it(`${status} -> "${copy}" in both places`, () => {
        const c = claim({ status });
        const note = donateClosedReason(status, c);
        expect(note).toBe(copy);
        expect(notAcceptingFunds({ status }, c)).toBe(note);
        // First paint (no claim view yet) agrees too.
        expect(notAcceptingFunds({ status }, null)).toBe(copy);
      });
    }
  }

  it("the paused line is the Donate modal's existing string (one definition)", () => {
    expect(DONATE_PAUSED_LINE).toBe("Donations are paused for this proposal right now.");
    expect(MODAL_PAUSED_LINE).toBe(DONATE_PAUSED_LINE);
  });
});

describe("voided stays closed (live signet 001-005, 008 shape)", () => {
  it("claim status voided / state unavailable -> closed", () => {
    expect(donateClosedReason("voided", claim({ status: "voided" }))).toBe(DONATE_CLOSED_OTHER);
  });
  it("catalog voided while the claim view still says listed -> closed, not paused", () => {
    expect(donateClosedReason("voided", claim({ status: "listed" }))).toBe(DONATE_CLOSED_OTHER);
    expect(notAcceptingFunds({ status: "voided" }, claim({ status: "listed" }))).toBe(DONATE_CLOSED_OTHER);
  });
  it("claim state voided on a listed row -> closed", () => {
    expect(donateClosedReason("listed", claim({ status: "listed", state: "voided" }))).toBe(DONATE_CLOSED_OTHER);
  });
  it("catalog declined while the claim view still says listed -> closed", () => {
    expect(donateClosedReason("declined", claim({ status: "listed" }))).toBe(DONATE_CLOSED_OTHER);
  });
  it("live 006/007/009 shapes -> complete", () => {
    expect(donateClosedReason("in_review", claim({ status: "bounty_settled", state: "settled" }))).toBe(DONATE_CLOSED_COMPLETE);
    expect(donateClosedReason("bounty_settled", claim({ status: "bounty_settled", state: "settled" }))).toBe(DONATE_CLOSED_COMPLETE);
    expect(donateClosedReason("in_review", claim({ status: "in_review", state: "in_review" }))).toBe(DONATE_CLOSED_COMPLETE);
  });
});

describe("rendered next card uses the shared copy", () => {
  it("declined row: detail is the closed line (same as the note)", () => {
    const p = proposal({ status: "declined", path: "proposals/declined/PLEBLY-X.md" });
    const c = claim({ status: "declined" });
    const a = resolveNextAction({ proposal: p, claim: c });
    expect(a.detail).toBe(DONATE_CLOSED_OTHER);
    expect(a.detail).toBe(donateClosedReason("declined", c));
  });

  it("listed row, catalog accepting_funds false: Donate copy becomes the paused line", () => {
    const p = proposal({ status: "listed", accepting_funds: false } as Partial<Proposal>);
    const a = resolveNextAction({ proposal: p, claim: null });
    expect(a.button).toBeNull();
    expect(`${a.sentence} ${a.detail ?? ""}`).toContain(DONATE_PAUSED_LINE);
    expect(`${a.sentence} ${a.detail ?? ""}`).not.toMatch(/isn.t accepting (funds|gifts)|Donations are open/);
  });

  it("listed row, funding PSBT built (claim view psbt_ready, funds closed): paused line", () => {
    const p = proposal({ status: "listed" });
    const c = claim({
      status: "listed",
      state: "open",
      accepting_claims: true,
      psbt: { structured_state: "psbt_ready" } as ClaimStatus["psbt"],
    });
    const a = resolveNextAction({ proposal: p, claim: c });
    expect(a.button).not.toBe("donate");
    const text = `${a.sentence} ${a.detail ?? ""}`;
    expect(text).toContain(DONATE_PAUSED_LINE);
    expect(text).toContain(donateClosedReason("listed", c)!);
  });
});
