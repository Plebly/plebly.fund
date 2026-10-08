import { describe, expect, it } from "vitest";
import { nextActionCardHtml, resolveNextAction } from "./next-action";
import type { ClaimStatus } from "./builder";
import type { Proposal } from "./types";

/**
 * A declined (not declined_fundable) row used to fall through to the final
 * fallback in resolveNextAction and read "Listed — still raising" with no
 * button. These pin the declined copy instead.
 */

const NOT_ACCEPTING = "This listing isn't accepting funds.";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "PLEBLY-SIGNET-DEMO",
    path: "proposals/declined/PLEBLY-SIGNET-DEMO.md",
    title: "Demo",
    status: "declined",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    proposer: { id: "github:1", github: "alice", username: "alice" },
    ...partial,
  };
}

function claim(partial: Partial<ClaimStatus> = {}): ClaimStatus {
  return {
    proposal_id: "PLEBLY-SIGNET-DEMO",
    proposal_path: "proposals/declined/PLEBLY-SIGNET-DEMO.md",
    state: "unavailable",
    confirmed_balance_sats: 0,
    claim_floor_sats: 10_000,
    ...partial,
  };
}

const visitor = { id: "github:3", username: "carol", github: "carol" };
const proposer = { id: "github:1", username: "alice", github: "alice" };

function expectDeclined(action: ReturnType<typeof resolveNextAction>) {
  expect(action.sentence).toBe("Listing declined.");
  expect(action.detail).toBe(NOT_ACCEPTING);
  expect(action.button).toBeNull();
  expect(`${action.sentence} ${action.detail}`).not.toMatch(/raising|Donate|Donations are open/);
}

describe("resolveNextAction: declined row", () => {
  it("bounty, no claim view (first paint)", () => {
    expectDeclined(resolveNextAction({ proposal: proposal() }));
  });

  it("bounty, signed-in visitor and proposer", () => {
    expectDeclined(resolveNextAction({ proposal: proposal(), user: visitor }));
    expectDeclined(resolveNextAction({ proposal: proposal(), user: proposer }));
  });

  it("bounty, claim view loaded with state unavailable", () => {
    expectDeclined(
      resolveNextAction({ proposal: proposal(), claim: claim(), user: visitor }),
    );
  });

  it("catalog declined wins over a runtime/frontmatter listed on the claim view", () => {
    // Before the fix this hit the listed branch: "Listed — still raising" + Donate.
    const action = resolveNextAction({
      proposal: proposal(),
      claim: claim({ state: "open", status: "listed", confirmed_balance_sats: 30_000 }),
      user: visitor,
    });
    expectDeclined(action);
  });

  it("direct proposal declined does not say Donate. Paid monthly.", () => {
    expectDeclined(
      resolveNextAction({ proposal: proposal({ proposal_type: "direct" }), user: proposer }),
    );
  });

  it("declined_fundable keeps its own copy and Donate", () => {
    const action = resolveNextAction({ proposal: proposal({ status: "declined_fundable" }) });
    expect(action.sentence).toBe("Listing declined. You can still fund.");
    expect(action.button).toBe("donate");
  });

  it("voided keeps its own copy", () => {
    expect(resolveNextAction({ proposal: proposal({ status: "voided" }) }).sentence).toBe(
      "Voided, not accepting funds.",
    );
  });

  it("listed still reads as raising", () => {
    const action = resolveNextAction({ proposal: proposal({ status: "listed" }) });
    expect(action.sentence).toBe("Listed — still raising");
    expect(action.button).toBe("donate");
  });

  it("never reads as raising, whatever the claim view says", () => {
    const claims: (ClaimStatus | null)[] = [
      null,
      claim(),
      claim({ state: "open", status: "listed" }),
      claim({ state: "below_floor", status: "listed" }),
      claim({ accepting_funds: false }),
      claim({ state: "open", status: "funding", psbt: { structured_state: "awaiting_funds" } }),
    ];
    for (const c of claims) {
      const action = resolveNextAction({ proposal: proposal(), claim: c, user: visitor });
      expect(action.sentence).not.toMatch(/raising/);
      expect(action.button).toBeNull();
    }
  });
});

describe("resolveNextAction: earlier exits still win over declined", () => {
  it("declined + voided structure reads Structure unavailable", () => {
    const action = resolveNextAction({
      proposal: proposal(),
      claim: claim({ state: "open", psbt: { structured_state: "voided" } }),
      user: visitor,
    });
    expect(action.sentence).toBe("Structure unavailable, not accepting funds.");
    expect(action.button).toBeNull();
  });

  it("declined + settled bounty reads Bounty paid.", () => {
    const action = resolveNextAction({
      proposal: proposal(),
      claim: claim({ state: "settled", claim_phase: "settled" }),
      user: visitor,
    });
    expect(action.sentence).toBe("Bounty paid.");
    expect(action.button).toBeNull();
  });

  it("declined + release_blocked_reason reads Release stalled", () => {
    const action = resolveNextAction({
      proposal: proposal({
        release_blocked_reason: "keyholders_unsigned",
        release_blocked_seats: [2, 4],
      }),
      user: visitor,
    });
    expect(action.sentence).toBe("Release stalled. Unsigned: seat 2, seat 4.");
    expect(action.button).toBeNull();
  });
});

describe("next card HTML: declined row", () => {
  it("renders declined copy with no Donate button", () => {
    const html = nextActionCardHtml(resolveNextAction({ proposal: proposal() }));
    expect(html).toContain("Listing declined.");
    expect(html).toContain(NOT_ACCEPTING);
    expect(html).not.toContain("still raising");
    expect(html).not.toContain("data-open-donate");
    expect(html).not.toContain("next-card-primary");
  });
});
