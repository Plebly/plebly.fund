/**
 * UI-2: first paint of the proposal page must not show the escrow address row
 * on a catalog-blocked row (voided / settled / not accepting funds). Before,
 * it rendered until builder-panel removed #onchain-escrow-row once the claim
 * view resolved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderProposalPage } from "./proposal-page";
import type { Proposal } from "./types";

const ESCROW = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const FEE_TXID = "ab".repeat(32);

function row(over: Partial<Proposal>): Proposal {
  return {
    id: "PLEBLY-2026-001",
    path: "proposals/listed/PLEBLY-2026-001.md",
    title: "Escrow paint",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 50_000,
    balance_sats: 10_586,
    escrow_address: ESCROW,
    submission_fee_txid: FEE_TXID,
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "## Summary\n\nBody.",
    ...over,
  } as Proposal;
}

/** Render with every network call pending: what is on screen is first paint. */
async function firstPaint(p: Proposal): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
  void renderProposalPage(p.path, (inner) => inner, null, () => undefined, {
    ...p,
    endowment_funded: false,
  });
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-onchain")) throw new Error("not painted yet");
  });
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("proposal page first paint: escrow row", () => {
  const blocked: [string, Partial<Proposal>][] = [
    [
      "voided structure (001: in_review, accepting_funds false)",
      { status: "in_review", structured_state: "voided", accepting_funds: false },
    ],
    [
      "listed but accepting_funds false",
      { status: "listed", structured_state: "psbt_ready", accepting_funds: false },
    ],
    ["unreadable structure", { status: "claimable", structured_state: "unreadable" }],
    ["status voided", { status: "voided" }],
    ["status bounty_settled", { status: "bounty_settled" }],
    ["bounty_settled:true", { status: "claimable", bounty_settled: true }],
  ];
  for (const [name, over] of blocked) {
    it(`catalog-blocked (${name}): no escrow address in the on-chain panel`, async () => {
      const app = await firstPaint(row(over));
      const panel = app.querySelector(".proposal-onchain")!;
      expect(panel.querySelector("#onchain-escrow-row")).toBeNull();
      expect(panel.innerHTML).not.toContain(ESCROW);
      // Rest of the panel still renders.
      expect(panel.innerHTML).toContain(FEE_TXID);
    });
  }

  it("donate-eligible row: escrow stays out of the panel (donate placeholder carries it), as before", async () => {
    const app = await firstPaint(
      row({ status: "listed", structured_state: "awaiting_funds", accepting_funds: true }),
    );
    expect(app.querySelector(".proposal-onchain #onchain-escrow-row")).toBeNull();
    expect(app.querySelector(".proposal-donate-slot")).not.toBeNull();
  });

  it("not blocked, not donate chrome (completed): escrow row still shown, as before", async () => {
    const app = await firstPaint(
      row({ status: "completed", structured_state: "confirmed", accepting_funds: true }),
    );
    expect(app.querySelector(".proposal-onchain #onchain-escrow-row")).not.toBeNull();
    expect(app.querySelector(".proposal-onchain")!.innerHTML).toContain(ESCROW);
  });
});
