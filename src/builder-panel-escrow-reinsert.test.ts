/**
 * UI-2 (shape 2): when the claim view allows Donate, builder-panel re-inserts
 * #onchain-escrow-row and fills Donate chrome (sidebar button, mobile CTA,
 * ?donate auto-open, modal). None of that may happen — not even transiently —
 * when the catalog row is donate-blocked, voided or settled: the catalog wins
 * over the claim view.
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

/**
 * Records anything Donate/escrow-shaped that enters the DOM.
 * - Escrow text and Donate buttons count when still in the live DOM at a
 *   microtask checkpoint (they would survive an await and could paint); a node
 *   added and removed in one synchronous run never reaches the screen.
 * - #donate-modal counts on ANY insertion, even if removed in the same tick:
 *   opening it moves focus and locks scroll as a side effect.
 */
function traceDom() {
  const trace = { escrowEverInMarkup: false, donateBtnEver: false, modalEver: false };
  const scan = (n: Node) => {
    if (n instanceof Element && (n.matches("#donate-modal") || n.querySelector("#donate-modal"))) {
      trace.modalEver = true;
    }
    if (!n.isConnected) return;
    if (n instanceof Element) {
      const html = n.outerHTML;
      if (/tb1q/.test(html)) trace.escrowEverInMarkup = true;
      if (n.matches("[data-open-donate], #donate-open") || n.querySelector("[data-open-donate], #donate-open")) {
        trace.donateBtnEver = true;
      }
    } else if (n.nodeType === Node.TEXT_NODE && /tb1q/.test(n.textContent || "")) {
      trace.escrowEverInMarkup = true;
    }
  };
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach(scan);
      if (r.type === "attributes" || r.type === "characterData") scan(r.target);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  return { trace, flush: () => { obs.takeRecords().forEach((r) => r.addedNodes.forEach(scan)); obs.disconnect(); } };
}

async function bindWithDonateAllowedClaimView(p: Proposal, duringBind?: () => void) {
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
  const dom = traceDom();
  // As proposal-page sets it on first paint: ?donate pending. builder-panel adds
  // the catalog flag itself.
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
  // As renderProposalPage does first: this project's page is the one on screen.
  (await import("./proposal-ui")).beginDonateProject(p.path);
  const bound = bindBuilderPanel(document, { proposal: p, balance: 200_000, user: null, watching: false });
  // Runs after bindBuilderPanel's synchronous start (early Donate context set),
  // before the claim view has resolved.
  duringBind?.();
  await bound;
  // Refresh has rendered once the next-card sentence is replaced.
  await vi.waitFor(() => {
    expect(document.querySelector("#next-card-sentence")?.textContent || "").not.toBe("");
  });
  return { ui, dom };
}

afterEach(() => {
  vi.doUnmock("./builder");
  document.body.innerHTML = "";
});

const BLOCKED: [string, Partial<Proposal>][] = [
  ["001 shape: in_review + accepting_funds false", { status: "in_review", accepting_funds: false }],
  ["status voided (no accepting_funds field)", { status: "voided" }],
  ["status bounty_settled", { status: "bounty_settled" }],
  ["bounty_settled:true on a claimable row", { bounty_settled: true }],
  ["claim_phase settled", { claim_phase: "settled" }],
];

describe("builder-panel escrow re-insert vs catalog block", () => {
  for (const [name, over] of BLOCKED) {
    it(`${name} + claim view allows Donate -> #onchain-escrow-row never re-inserted`, async () => {
      await bindWithDonateAllowedClaimView(proposal(over));
      await new Promise((r) => setTimeout(r, 50));
      expect(document.querySelector("#onchain-escrow-row")).toBeNull();
      expect(document.querySelector(".onchain-panel")!.innerHTML).not.toContain(ESCROW);
    });

    it(`${name} + claim view allows Donate -> no Donate button, CTA, modal or escrow, ever`, async () => {
      const { ui, dom } = await bindWithDonateAllowedClaimView(proposal(over));
      await new Promise((r) => setTimeout(r, 50));
      dom.flush();
      expect(document.querySelector("[data-open-donate], #donate-open")).toBeNull();
      const cta = document.querySelector<HTMLElement>("#mobile-cta-slot")!;
      expect(cta.hidden).toBe(true);
      expect(cta.innerHTML).toBe("");
      // Not even transiently (e.g. across the syncHybridReviewUi await).
      expect(dom.trace).toEqual({ escrowEverInMarkup: false, donateBtnEver: false, modalEver: false });
      expect(document.documentElement.outerHTML).not.toMatch(/tb1q/);
      // The ?donate deep link was never consumed.
      expect(ui.getDonateChromeContext()?.wantsDonateOpen).toBe(true);
    });

    for (const when of ["before", "after"] as const) {
      it(`${name}: a stray [data-open-donate] click ${when} the claim view lands opens nothing`, async () => {
        const strayClick = () => {
          document.querySelector(".proposal-page")!.insertAdjacentHTML(
            "beforeend",
            `<button type="button" id="stray" data-open-donate>Donate</button>`,
          );
          document.querySelector<HTMLButtonElement>("#stray")!.click();
        };
        const { ui, dom } = await bindWithDonateAllowedClaimView(
          proposal(over),
          when === "before" ? strayClick : undefined,
        );
        if (when === "after") strayClick();
        expect(await ui.ensureDonateModalMounted(document)).toBeNull();
        await new Promise((r) => setTimeout(r, 50));
        dom.flush();
        expect(dom.trace.modalEver).toBe(false);
        expect(dom.trace.escrowEverInMarkup).toBe(false);
        expect(document.documentElement.outerHTML).not.toMatch(/tb1q/);
      });
    }
  }

  it("unblocked donate-eligible row + claim view allows Donate -> row re-inserted, Donate chrome shown (unchanged)", async () => {
    const { ui, dom } = await bindWithDonateAllowedClaimView(proposal({}));
    await vi.waitFor(() => {
      expect(document.querySelector(".onchain-panel #onchain-escrow-row")).not.toBeNull();
    });
    expect(document.querySelector("[data-open-donate]")).not.toBeNull();
    const cta = document.querySelector<HTMLElement>("#mobile-cta-slot")!;
    expect(cta.hidden).toBe(false);
    expect(cta.querySelector("[data-open-donate]")).not.toBeNull();
    expect(ui.getDonateChromeContext()?.wantsDonateOpen).toBe(false);
    expect(document.querySelector("#donate-modal")).not.toBeNull();
    dom.flush();
    // The trace does see escrow + Donate when they are allowed.
    expect(dom.trace.escrowEverInMarkup).toBe(true);
    expect(dom.trace.donateBtnEver).toBe(true);
    expect(dom.trace.modalEver).toBe(true);
  });
});
