/**
 * UI-2 (shape 2): when the claim view allows Donate, builder-panel re-inserts
 * #onchain-escrow-row and fills Donate chrome (sidebar button, mobile CTA,
 * ?donate auto-open). None of that may happen when the catalog row is voided
 * or settled — the catalog wins over the claim view.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";

const ESCROW = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "claimable",
    target_sats: null,
    escrow_address: ESCROW,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 200_000,
    ...partial,
  };
}

async function bindWithDonateAllowedClaimView(p: Proposal) {
  vi.resetModules();
  vi.doMock("./builder", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./builder")>();
    return {
      ...actual,
      // Claim view says Donate is allowed: open, pooling, accepting funds.
      fetchClaimStatus: vi.fn(async () => ({
        proposal_id: "demo",
        proposal_path: "proposals/listed/demo.md",
        state: "open",
        status: "claimable",
        confirmed_balance_sats: 200_000,
        claim_floor_sats: 10_000,
        escrow_address: ESCROW,
        title: "Demo",
        accepting_funds: true,
        psbt: { structured_state: "awaiting_funds" },
      })),
      fetchClaimApplications: vi.fn(async () => null),
      fetchClaimParams: vi.fn(async () => ({
        claim_bond_sats: 10_000,
        max_active_claims: 1,
        reclaim_cooldown_days: 30,
        checkpoint_day: 45,
        checkpoint_grace_days: 7,
        fee_address: null,
      })),
      fetchPayoutStatus: vi.fn(async () => null),
    };
  });
  const ui = await import("./proposal-ui");
  const { bindBuilderPanel } = await import("./builder-panel");
  document.body.innerHTML = `<div id="app">
    <article class="proposal-page">
      <div id="builder" class="builder-panel">
        <div class="builder-actions">
          <button type="button" class="btn ghost next-card-watch" id="builder-watch" data-watching="0">Watch</button>
        </div>
        <div id="builder-body" class="builder-body">
          <div class="next-card-main"><p class="next-card-sentence">Loading</p></div>
          <div id="claim-apps-host"></div>
        </div>
        <p class="builder-msg" id="builder-msg" hidden></p>
      </div>
      <div class="proposal-donate-slot" hidden></div>
      <details class="proposal-onchain"><summary>On-chain details</summary>
        <div class="onchain-panel"><div class="onchain-row">fee</div></div>
      </details>
      <div id="mobile-cta-slot" hidden></div>
    </article>
  </div>`;
  // ?donate deep link pending: builder-panel opens the modal only if Donate is allowed.
  ui.setDonateChromeContext({
    root: document,
    proposal: p,
    panelOpts: {
      address: ESCROW,
      proposalId: p.id,
      proposalPath: p.path,
      proposalTitle: p.title,
      signedIn: true,
    },
    wantsDonateOpen: true,
  });
  ui.bindDonateModal(document);
  await bindBuilderPanel(document, { proposal: p, balance: 200_000, user: null, watching: false });
  // Refresh has rendered once the next-card sentence is replaced.
  await vi.waitFor(() => {
    expect(document.querySelector("#next-card-sentence")?.textContent || "").not.toBe("");
  });
  return ui;
}

afterEach(() => {
  vi.doUnmock("./builder");
  document.body.innerHTML = "";
});

describe("builder-panel escrow re-insert vs catalog block", () => {
  for (const [name, over] of [
    ["status voided (no accepting_funds field)", { status: "voided" }],
    ["status bounty_settled", { status: "bounty_settled" }],
    ["bounty_settled:true on a claimable row", { bounty_settled: true }],
    ["claim_phase settled", { claim_phase: "settled" }],
  ] as const) {
    it(`${name} + claim view allows Donate -> #onchain-escrow-row never re-inserted`, async () => {
      await bindWithDonateAllowedClaimView(proposal(over as Partial<Proposal>));
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelector("#onchain-escrow-row")).toBeNull();
      expect(document.querySelector(".onchain-panel")!.innerHTML).not.toContain(ESCROW);
    });

    it(`${name} + claim view allows Donate -> no Donate button, no mobile CTA, no auto-open`, async () => {
      const ui = await bindWithDonateAllowedClaimView(proposal(over as Partial<Proposal>));
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelector("[data-open-donate], #donate-open")).toBeNull();
      const cta = document.querySelector<HTMLElement>("#mobile-cta-slot")!;
      expect(cta.hidden).toBe(true);
      expect(cta.innerHTML).toBe("");
      // Modal (which carries the escrow address) is never mounted.
      expect(document.querySelector("#donate-modal")).toBeNull();
      // The ?donate deep link was never consumed.
      expect(ui.getDonateChromeContext()?.wantsDonateOpen).toBe(true);
    });
  }

  it("unblocked donate-eligible row + claim view allows Donate -> row re-inserted, Donate chrome shown (unchanged)", async () => {
    const ui = await bindWithDonateAllowedClaimView(proposal({}));
    await vi.waitFor(() => {
      expect(document.querySelector(".onchain-panel #onchain-escrow-row")).not.toBeNull();
    });
    expect(document.querySelector("[data-open-donate]")).not.toBeNull();
    const cta = document.querySelector<HTMLElement>("#mobile-cta-slot")!;
    expect(cta.hidden).toBe(false);
    expect(cta.querySelector("[data-open-donate]")).not.toBeNull();
    expect(ui.getDonateChromeContext()?.wantsDonateOpen).toBe(false);
    expect(document.querySelector("#donate-modal")).not.toBeNull();
  });
});
