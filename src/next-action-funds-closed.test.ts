// workers#51 pairing: the claim view sends accepting_funds:false for every row
// whose status is not FUNDABLE. That must hide Donate and the escrow address
// only; claimed / in_review / refunding rows keep their actions. Every action
// is blocked only for accepting_claims:false without bounty_settled, a
// terminal/unknown structured state, or an unknown claim state.
import { describe, expect, it } from "vitest";
import type { ClaimStatus } from "./builder";
import {
  isClaimViewBlocked,
  isClaimViewDonateAllowed,
  isDonateBlocked,
  resolveNextAction,
  type NextActionInput,
} from "./next-action";
import type { Proposal } from "./types";

const BLOCKED = "Structure unavailable, not accepting funds.";

const proposal = (p: Partial<Proposal> = {}): Proposal => ({
  id: "demo",
  path: "proposals/listed/demo.md",
  title: "Demo",
  status: "listed",
  target_sats: null,
  escrow_address: "tb1qtest",
  submission_fee_txid: null,
  created_at: null,
  escrow_index: null,
  milestones: [],
  body: "",
  proposer: { id: "github:1", github: "alice", username: "alice" },
  ...p,
});

const claim = (p: Partial<ClaimStatus> = {}): ClaimStatus => ({
  proposal_id: "demo",
  proposal_path: "proposals/claimed/demo.md",
  state: "open",
  confirmed_balance_sats: 200_000,
  claim_floor_sats: 10_000,
  ...p,
});

const proposerUser = { id: "github:1", username: "alice", github: "alice" };
const builderUser = { id: "github:2", username: "bob", github: "bob" };
const donorUser = { id: "github:3", username: "carol", github: "carol" };

/** The three rows workers#51 closes funds on, as the claim view sends them. */
const claimedBuilder = (c: Partial<ClaimStatus> = {}): NextActionInput => ({
  proposal: proposal({ status: "claimed", claimer: "bob", path: "proposals/claimed/demo.md" }),
  claim: claim({ state: "claimed", claimer: "bob", accepting_funds: false, ...c }),
  user: builderUser,
});
const inReviewProposer = (c: Partial<ClaimStatus> = {}): NextActionInput => ({
  proposal: proposal({ status: "in_review", claimer: "bob" }),
  claim: claim({ state: "in_review", claimer: "bob", can_mark_done: true, accepting_funds: false, ...c }),
  user: proposerUser,
});
const refundingDonor = (c: Partial<ClaimStatus> = {}): NextActionInput => ({
  proposal: proposal({ status: "refunding" }),
  claim: claim({ state: "unavailable", accepting_funds: false, ...c }),
  user: donorUser,
});

// Pre-#44 Workers (no accepting_claims) and #44+#51 (accepting_claims:true).
const SHAPES: [string, Partial<ClaimStatus>][] = [
  ["accepting_claims absent", {}],
  ["accepting_claims:true", { accepting_claims: true }],
];

describe("workers#51 accepting_funds:false keeps the row's actions", () => {
  for (const [shape, extra] of SHAPES) {
    describe(shape, () => {
      it("claimed builder keeps Submit work; Donate hidden", () => {
        const input = claimedBuilder(extra);
        const a = resolveNextAction(input);
        expect(a.button).toBe("deliverable");
        expect(a.sentence).toBe("Submit the work when it is done.");
        expect(isClaimViewDonateAllowed(input.claim!)).toBe(false);
        expect(isDonateBlocked(input.proposal, input.claim!)).toBe(true);
      });

      it("in_review proposer keeps Mark it done; Donate hidden", () => {
        const input = inReviewProposer(extra);
        const a = resolveNextAction(input);
        expect(a.button).toBe("done");
        expect(a.sentence).toBe("Mark it done if the work is finished.");
        expect(isClaimViewDonateAllowed(input.claim!)).toBe(false);
        expect(isDonateBlocked(input.proposal, input.claim!)).toBe(true);
      });

      it("refunding donor keeps Add a refund address; Donate hidden", () => {
        const input = refundingDonor(extra);
        const a = resolveNextAction(input);
        expect(a.button).toBe("register");
        expect(a.sentence).toBe("Add a refund address.");
        expect(isClaimViewDonateAllowed(input.claim!)).toBe(false);
        expect(isDonateBlocked(input.proposal, input.claim!)).toBe(true);
      });
    });
  }

  it("claimed row, non-builder: no pooling Donate button when funds are closed", () => {
    const input = { ...claimedBuilder(), user: donorUser };
    const a = resolveNextAction(input);
    expect(a.button).toBeNull();
    expect(a.sentence).toBe("Waiting on the builder.");
  });

  it("in_review row, non-proposer: no pooling Donate button when funds are closed", () => {
    const input = { ...inReviewProposer(), user: donorUser };
    const a = resolveNextAction(input);
    expect(a.button).toBeNull();
    expect(a.sentence).toBe("Waiting on the proposer.");
  });

  it("control: pooling claimed row with funds open still offers Donate", () => {
    const input = { ...claimedBuilder({ accepting_funds: true }), user: donorUser };
    const a = resolveNextAction(input);
    expect(a.button).toBe("donate");
  });
});

describe("blocked controls (every action blocked)", () => {
  it("accepting_claims:false and not settled blocks the claimed builder", () => {
    const a = resolveNextAction(claimedBuilder({ accepting_claims: false }));
    expect(a).toMatchObject({ sentence: BLOCKED, button: null });
    expect(isClaimViewBlocked(claimedBuilder({ accepting_claims: false }).claim!, "claimed")).toBe(true);
  });

  it("accepting_claims:false and not settled blocks the in_review proposer and refunding donor", () => {
    expect(resolveNextAction(inReviewProposer({ accepting_claims: false }))).toMatchObject({ sentence: BLOCKED, button: null });
    expect(resolveNextAction(refundingDonor({ accepting_claims: false }))).toMatchObject({ sentence: BLOCKED, button: null });
  });

  it("accepting_claims:false with bounty_settled keeps the claimant's action (override control)", () => {
    const a = resolveNextAction(claimedBuilder({ accepting_claims: false, bounty_settled: true }));
    expect(a.button).toBe("deliverable");
    expect(
      isClaimViewBlocked({ state: "claimed", accepting_funds: false, accepting_claims: false, bounty_settled: true }, "claimed"),
    ).toBe(false);
  });

  it("terminal structured state (voided) blocks even with accepting_claims:true", () => {
    const a = resolveNextAction(
      claimedBuilder({ accepting_claims: true, psbt: { structured_state: "voided" } as ClaimStatus["psbt"] }),
    );
    expect(a).toMatchObject({ sentence: BLOCKED, button: null });
  });

  it("unknown structured state blocks the in_review proposer", () => {
    const a = resolveNextAction(
      inReviewProposer({ psbt: { structured_state: "mystery_state" } as ClaimStatus["psbt"] }),
    );
    expect(a).toMatchObject({ sentence: BLOCKED, button: null });
  });

  it("unknown claim state blocks", () => {
    const a = resolveNextAction(
      claimedBuilder({ state: "mystery" as ClaimStatus["state"], accepting_claims: true }),
    );
    expect(a).toMatchObject({ sentence: "Unavailable.", button: null });
    expect(isClaimViewBlocked({ state: "mystery", accepting_funds: true }, "claimed")).toBe(true);
  });
});

describe("fail closed for Workers without accepting_claims (pre-#44)", () => {
  it("listed row with accepting_funds:false (unreadable/unresolved record) still blocks every action", () => {
    const input: NextActionInput = {
      proposal: proposal({ status: "listed" }),
      claim: claim({ state: "unavailable", accepting_funds: false }),
      user: donorUser,
    };
    expect(resolveNextAction(input)).toMatchObject({ sentence: BLOCKED, button: null });
  });

  it("claimable row with accepting_funds:false still blocks Apply", () => {
    const input: NextActionInput = {
      proposal: proposal({ status: "claimable" }),
      claim: claim({ state: "unavailable", accepting_funds: false }),
      user: builderUser,
    };
    expect(resolveNextAction(input)).toMatchObject({ sentence: BLOCKED, button: null });
  });

  it("isClaimViewBlocked with no status fails closed on accepting_funds:false", () => {
    expect(isClaimViewBlocked({ state: "claimed", accepting_funds: false })).toBe(true);
    expect(isClaimViewBlocked({ state: "claimed", accepting_funds: false }, "claimed")).toBe(false);
  });

  it("control: listed row with accepting_funds:true offers Donate", () => {
    const input: NextActionInput = {
      proposal: proposal({ status: "listed" }),
      claim: claim({ state: "below_floor", accepting_funds: true }),
      user: donorUser,
    };
    expect(resolveNextAction(input).button).toBe("donate");
  });
});

// Review's CATALOG-1 drift probe (probes/f69/drift.test.ts), imports adapted.
// Stale catalog row (claimable/listed, pre-refresh) next to a #44+#51 claim view
// with accepting_funds:false and accepting_claims:true. Kills M4 (the
// `accepting_claims == null` scoping of the pre-#44 fallback) and M10 (the
// Donate strip in resolveNextAction).
const P = (status: string): Proposal => ({ id: "p1", path: "proposals/listed/p1.md", title: "P", status, target_sats: 50000, escrow_address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", submission_fee_txid: null, created_at: null, escrow_index: null, milestones: [], body: "", proposer: { id: "github:1", github: "alice", username: "alice" }, claimer: "bob" } as Proposal);
const C = { proposal_id: "p1", proposal_path: "proposals/claimed/p1.md", state: "claimed", claimer: "bob", confirmed_balance_sats: 200000, claim_floor_sats: 10000, accepting_funds: false, accepting_claims: true, bounty_settled: false, psbt: { structured_state: "psbt_ready" } } as unknown as ClaimStatus;
const builder = { id: "github:2", username: "bob", github: "bob" };
for (const cat of ["claimable", "listed"]) {
  it(`DRIFT catalog ${cat}, claim view claimed (af:false, ac:true): builder keeps Submit work`, () => {
    const r = resolveNextAction({ proposal: P(cat), claim: C, user: builder, isBuilder: true } as never);
    console.log(`DRIFT builder catalog=${cat}: ${r.sentence} [${r.button ?? "-"}]`);
    expect(r.button).toBe("deliverable");
  });
  it(`DRIFT catalog ${cat}, claim view claimed (af:false, ac:true): anon gets no Donate button`, () => {
    const r = resolveNextAction({ proposal: P(cat), claim: C } as never);
    console.log(`DRIFT anon catalog=${cat}: ${r.sentence} [${r.button ?? "-"}]`);
    expect(r.button).not.toBe("donate");
  });
}
for (const cat of ["claimable", "listed"]) {
  it(`DRIFT catalog ${cat}, runtime moved to refunding/declined (state unavailable, af:false, ac:true): no Donate button`, () => {
    const c = { ...C, state: "unavailable", claimer: null, psbt: undefined } as unknown as ClaimStatus;
    const r = resolveNextAction({ proposal: { ...P(cat), claimer: undefined } as Proposal, claim: c } as never);
    console.log(`DRIFT2 anon catalog=${cat}: ${r.sentence} [${r.button ?? "-"}]`);
    expect(r.button).not.toBe("donate");
  });
}
