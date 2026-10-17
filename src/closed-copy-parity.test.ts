// One wording per closed page: the next card and the Donate-slot note
// (donate-closed-note.ts) use the same status groups and copy (UI UX).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("structure unavailable: temporary (unreadable) vs final (voided)", () => {
  // Workers: KV/parse failure on the funding record -> catalog row
  // status "voided" + structured_state "unreadable" (fail closed), claim view
  // state "unavailable", accepting_claims false, no psbt. Next good read restores it.
  const unreadableClaim = () =>
    claim({ status: "listed", state: "unavailable", accepting_claims: false });

  it("catalog voided+unreadable, claim view listed -> paused in both places", () => {
    expect(donateClosedReason("voided", unreadableClaim(), "unreadable")).toBe(DONATE_PAUSED_LINE);
    expect(
      notAcceptingFunds({ status: "voided", structured_state: "unreadable" }, unreadableClaim()),
    ).toBe(DONATE_PAUSED_LINE);
  });

  it("catalog listed+unreadable, claim view listed -> paused in both places", () => {
    expect(donateClosedReason("listed", unreadableClaim(), "unreadable")).toBe(DONATE_PAUSED_LINE);
    expect(
      notAcceptingFunds({ status: "listed", structured_state: "unreadable" }, unreadableClaim()),
    ).toBe(DONATE_PAUSED_LINE);
  });

  it("real void: claim view record voided on a listed row -> closed", () => {
    const c = claim({
      status: "listed",
      state: "unavailable",
      accepting_claims: false,
      psbt: { structured_state: "voided" } as ClaimStatus["psbt"],
    });
    expect(donateClosedReason("listed", c, "voided")).toBe(DONATE_CLOSED_OTHER);
    expect(notAcceptingFunds({ status: "listed", structured_state: "voided" }, c)).toBe(DONATE_CLOSED_OTHER);
  });

  it("catalog voided+voided (live 001-005, 008) -> closed", () => {
    const c = claim({ status: "voided", state: "unavailable" });
    expect(donateClosedReason("voided", c, "voided")).toBe(DONATE_CLOSED_OTHER);
    expect(notAcceptingFunds({ status: "voided", structured_state: "voided" }, c)).toBe(DONATE_CLOSED_OTHER);
  });

  it("catalog voided with no structured_state passed -> closed (fail closed)", () => {
    expect(donateClosedReason("voided", claim({ status: "listed" }))).toBe(DONATE_CLOSED_OTHER);
  });

  it("unreadable but not a fundable status (declined) -> closed", () => {
    expect(donateClosedReason("declined", claim({ status: "declined" }), "unreadable")).toBe(DONATE_CLOSED_OTHER);
  });
});

describe("next card headlines (UI UX: short; the note says what happens to gifts)", () => {
  it("voided row: 'Voided'", () => {
    const a = resolveNextAction({ proposal: proposal({ status: "voided" }), claim: null });
    expect(a.sentence).toBe("Voided");
    expect(a.button).toBeNull();
  });

  it("unreadable structure on a listed row: 'Structure unavailable'", () => {
    const p = proposal({ status: "listed", structured_state: "unreadable" } as Partial<Proposal>);
    const a = resolveNextAction({ proposal: p, claim: null });
    expect(a.sentence).toBe("Structure unavailable");
    expect(a.button).toBeNull();
  });

  it("claim view unreadable (accepting_claims false, no psbt): 'Structure unavailable'", () => {
    const a = resolveNextAction({
      proposal: proposal({ status: "listed" }),
      claim: claim({ status: "listed", state: "unavailable", accepting_claims: false }),
    });
    expect(a.sentence).toBe("Structure unavailable");
  });
});

describe("next card: no long ', not accepting funds.' headlines left", () => {
  // The three "Structure voided" returns sit behind the earlier
  // "Structure unavailable" exit (same isStructuredTerminalOrUnknown check),
  // so pin the source text instead of a render.
  it("next-action.ts has no ', not accepting funds.' variant", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "next-action.ts"), "utf8");
    expect(src).not.toMatch(/, not accepting funds\./);
    expect(src.match(/sentence: "Structure voided"/g)?.length).toBe(3);
  });
});

describe("Review HOLD @af668a8: each voided signal closes on its own", () => {
  it("(a) catalog voided+unreadable, claim psbt voided (claim listed/unavailable) -> closed", () => {
    const c = claim({
      status: "listed",
      state: "unavailable",
      accepting_claims: false,
      psbt: { structured_state: "voided" } as ClaimStatus["psbt"],
    });
    expect(donateClosedReason("voided", c, "unreadable")).toBe(DONATE_CLOSED_OTHER);
    expect(notAcceptingFunds({ status: "voided", structured_state: "unreadable" }, c)).toBe(DONATE_CLOSED_OTHER);
  });

  it("(b) catalog listed+structured voided, claim listed, no psbt -> closed", () => {
    const c = claim({ status: "listed", state: "unavailable" });
    expect(donateClosedReason("listed", c, "voided")).toBe(DONATE_CLOSED_OTHER);
    expect(notAcceptingFunds({ status: "listed", structured_state: "voided" }, c)).toBe(DONATE_CLOSED_OTHER);
  });
});

describe("Review HOLD @af668a8: contradictory rows read closed, not complete", () => {
  const cases: [string, string | null, Partial<ClaimStatus>][] = [
    ["catalog voided + claim claimed/claimed", "voided", { status: "claimed", state: "claimed" }],
    ["catalog voided + claim state in_review", "voided", { state: "in_review" }],
    ["catalog declined + claim claimed", "declined", { status: "claimed", state: "claimed" }],
    ["catalog refunding + claim claimed", "refunding", { status: "claimed", state: "claimed" }],
    ["catalog rejected + claim claimed", "rejected", { status: "claimed", state: "claimed" }],
    ["listed + claim state voided, status completed", "listed", { status: "completed", state: "voided" }],
    ["workers rejected row (status rejected, state claimed)", "rejected", { status: "rejected", state: "claimed" }],
  ];
  for (const [label, catalogStatus, c] of cases) {
    it(`${label} -> closed in both places`, () => {
      const cv = claim(c);
      expect(donateClosedReason(catalogStatus, cv)).toBe(DONATE_CLOSED_OTHER);
      expect(notAcceptingFunds({ status: catalogStatus ?? "" }, cv)).toBe(DONATE_CLOSED_OTHER);
    });
  }

  it("settled beats voided: claim state settled on a catalog voided row -> complete", () => {
    expect(donateClosedReason("voided", claim({ state: "settled" }), "voided")).toBe(DONATE_CLOSED_COMPLETE);
  });
  it("settled beats voided: catalog bounty_settled with claim psbt voided -> complete", () => {
    const c = claim({ status: "bounty_settled", psbt: { structured_state: "voided" } as ClaimStatus["psbt"] });
    expect(donateClosedReason("bounty_settled", c)).toBe(DONATE_CLOSED_COMPLETE);
  });
});

describe("Review Low @af668a8: paused needs a known open claim state and a catalog status", () => {
  for (const state of ["refunding", "frobnicated", "completed_ish"]) {
    it(`listed row, claim state ${state} -> closed`, () => {
      expect(donateClosedReason("listed", claim({ status: "listed", state }))).toBe(DONATE_CLOSED_OTHER);
    });
  }
  for (const state of ["open", "below_floor", "claim_pending", "unavailable", ""]) {
    it(`listed row, claim state '${state}' -> paused`, () => {
      expect(donateClosedReason("listed", claim({ status: "listed", state }))).toBe(DONATE_PAUSED_LINE);
    });
  }
  it("missing catalog status (claim listed) -> closed, not paused", () => {
    expect(donateClosedReason(null, claim({ status: "listed", state: "open" }))).toBe(DONATE_CLOSED_OTHER);
    expect(donateClosedReason("", claim({ status: "listed", state: "open" }))).toBe(DONATE_CLOSED_OTHER);
  });
});
