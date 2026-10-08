/**
 * A declined (not declined_fundable) detail page must not show the escrow
 * address, the hero funding meter ("… to open" / "Applications closed") or
 * Donate, on first paint or after the claim view loads. Same for the other
 * blocked, non-fundable statuses (isClosedToFundsStatus).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isClosedToFundsStatus } from "./builder";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";

const ESCROW = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const NOT_ACCEPTING = "This listing isn't accepting funds.";

function row(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "PLEBLY-SIGNET-DEMO",
    path: "proposals/listed/PLEBLY-SIGNET-DEMO.md",
    title: "Demo",
    status: "declined",
    proposal_type: "bounty",
    target_sats: 50_000,
    escrow_address: ESCROW,
    // Keeps the on-chain panel on the page even without the address row.
    submission_fee_txid: "ab".repeat(32),
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "## Summary\n\nBody.",
    balance_sats: 5_000,
    ...over,
  } as Proposal;
}

function claimView(over: Partial<ClaimStatus> = {}): ClaimStatus {
  return {
    proposal_id: "PLEBLY-SIGNET-DEMO",
    proposal_path: "proposals/listed/PLEBLY-SIGNET-DEMO.md",
    state: "unavailable",
    status: "declined",
    confirmed_balance_sats: 5_000,
    claim_floor_sats: CLAIM_FLOOR_SATS,
    ...over,
  };
}

/** fetch: /claims/<id> → `claim` (or never resolves when null); everything else → {}. */
function stubFetch(claim: ClaimStatus | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        if (!claim) return new Promise<Response>(() => undefined);
        return Response.json(claim);
      }
      if (url.includes("/address/")) {
        return Response.json({
          chain_stats: { funded_txo_sum: 5_000, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

async function renderPage(p: Proposal, claim: ClaimStatus | null): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  stubFetch(claim);
  const { renderProposalPage } = await import("./proposal-page");
  void renderProposalPage(p.path, (inner) => inner, null, () => undefined, {
    ...p,
    endowment_funded: false,
  });
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-onchain, .proposal-sidebar, .proposal-layout")) {
      throw new Error("not painted yet");
    }
  });
  return app;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("isClosedToFundsStatus", () => {
  it("blocked and not fundable", () => {
    for (const s of [
      "declined",
      "DECLINED",
      "voided",
      "underfunded",
      "refunding",
      "redirected",
      "redirect_pending",
      "bounty_settled",
    ]) {
      expect(isClosedToFundsStatus(s)).toBe(true);
    }
  });
  it("fundable, pooling and post-award rows are not closed", () => {
    for (const s of [
      "listed",
      "funding",
      "claimable",
      "declined_fundable",
      "claimed",
      "in_review",
      "rejected",
      "completed",
      "",
    ]) {
      expect(isClosedToFundsStatus(s)).toBe(false);
    }
  });
});

describe("render helpers gate on status", () => {
  it("proposalFundingBarHtml: closed status renders nothing; listed renders the meter", async () => {
    const { proposalFundingBarHtml } = await import("./proposal-funding-bar");
    for (const status of ["declined", "voided", "refunding"]) {
      expect(proposalFundingBarHtml(5_000, CLAIM_FLOOR_SATS, 50_000, [], { status })).toBe("");
    }
    expect(proposalFundingBarHtml(5_000, CLAIM_FLOOR_SATS, 50_000, [], { status: "listed" })).toContain("to open");
    expect(proposalFundingBarHtml(5_000, CLAIM_FLOOR_SATS, 50_000)).toContain("funding-meter");
  });

  it("onChainPanelHtml: closed status drops the escrow row, keeps the fee row", async () => {
    const { onChainPanelHtml } = await import("./proposal-ui");
    const declined = onChainPanelHtml(row());
    expect(declined).not.toContain(ESCROW);
    expect(declined).toContain("Submission fee");
    expect(onChainPanelHtml(row({ status: "completed" }))).toContain(ESCROW);
    expect(onChainPanelHtml(row({ status: "listed" }))).toContain(ESCROW);
  });
});

describe("declined detail page, first paint (claim view still loading)", () => {
  it("balance > 0: no hero meter, no 'to open', no 'Applications closed'", async () => {
    const app = await renderPage(row({ balance_sats: 5_000 }), null);
    expect(app.querySelector(".proposal-funding-bar")).toBeNull();
    expect(app.querySelector(".funding-meter")).toBeNull();
    const hero = app.querySelector(".proposal-hero")?.parentElement?.textContent || "";
    expect(hero).not.toMatch(/to open/);
    expect(app.textContent).not.toMatch(/to open/);
  });

  it("balance past the floor: no 'Applications closed' meter", async () => {
    const app = await renderPage(row({ balance_sats: CLAIM_FLOOR_SATS + 1_000 }), null);
    expect(app.querySelector(".proposal-funding-bar")).toBeNull();
    expect(app.querySelector(".funding-meter-label")).toBeNull();
  });

  it("no escrow address row in the on-chain panel", async () => {
    const app = await renderPage(row(), null);
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(app.querySelector(".proposal-onchain")?.textContent || "").not.toContain(ESCROW);
    expect(app.querySelector("[data-open-donate]")).toBeNull();
  });

  it("voided and refunding rows: same gate", async () => {
    for (const status of ["voided", "refunding"]) {
      vi.resetModules();
      const app = await renderPage(row({ status }), null);
      expect(app.querySelector(".proposal-funding-bar")).toBeNull();
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    }
  });

  it("control: listed row keeps the meter ('to open'); completed keeps meter and address row", async () => {
    const listed = await renderPage(row({ status: "listed" }), null);
    expect(listed.querySelector(".proposal-funding-bar")).toBeTruthy();
    expect(listed.querySelector(".funding-meter-label")?.textContent).toMatch(/to open/);
    vi.resetModules();
    const done = await renderPage(row({ status: "completed" }), null);
    expect(done.querySelector(".proposal-funding-bar")).toBeTruthy();
    expect(done.querySelector("#onchain-escrow-row")).toBeTruthy();
    vi.resetModules();
    const fundable = await renderPage(row({ status: "declined_fundable" }), null);
    expect(fundable.querySelector(".proposal-funding-bar")).toBeTruthy();
  });
});

describe("declined detail page after the claim view loads", () => {
  it("claim view says accepting_funds:true (pre-workers#51): address row stays out, no Donate", async () => {
    const app = await renderPage(row(), claimView({ accepting_funds: true }));
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("next card not resolved");
    });
    // Give builder-panel's post-claim-view chrome pass a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(app.querySelector(".proposal-onchain .onchain-panel")).toBeTruthy();
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(app.querySelector(".proposal-onchain")?.textContent || "").not.toContain(ESCROW);
    expect(app.querySelector("[data-open-donate]")).toBeNull();
    expect(app.querySelector(".proposal-funding-bar")).toBeNull();
  });

  it("catalog declined wins over a claim view that says listed", async () => {
    const app = await renderPage(row(), claimView({ status: "listed", state: "open", accepting_funds: true }));
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("next card not resolved");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(app.querySelector(".proposal-onchain .onchain-panel")).toBeTruthy();
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(app.querySelector(".proposal-onchain")?.textContent || "").not.toContain(ESCROW);
  });

  it("pooling structure on a declined row does not bring Donate or the address back", async () => {
    const app = await renderPage(
      row(),
      claimView({ accepting_funds: true, psbt: { structured_state: "awaiting_funds" } as ClaimStatus["psbt"] }),
    );
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("next card not resolved");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(app.querySelector("[data-open-donate]")).toBeNull();
  });

  it(`"${NOT_ACCEPTING}" renders at most once on the page`, async () => {
    // One copy per page (UI UX). With plebly.fund#71 the next card carries it
    // once; plebly.fund#69's escrow-closed note needs an address row, which a
    // declined page no longer paints.
    const app = await renderPage(row(), claimView({ accepting_funds: false }));
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("next card not resolved");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(count(app.textContent || "", NOT_ACCEPTING)).toBeLessThanOrEqual(1);
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(app.querySelector("#onchain-escrow-closed-note")).toBeNull();
    expect(app.querySelector("#donate-closed-note")).toBeNull();
  });
});

describe("refunding detail page after the claim view loads (UI UX: keep refunding in the gate)", () => {
  for (const accepting of [false, true] as const) {
    it(`claim view accepting_funds:${accepting}: no address row, meter or Donate`, async () => {
      const app = await renderPage(
        row({ status: "refunding" }),
        claimView({ status: "refunding", state: "unavailable", accepting_funds: accepting, escrow_address: ESCROW }),
      );
      await vi.waitFor(() => {
        const s = app.querySelector("#next-card-sentence")?.textContent || "";
        if (!s || s === "…") throw new Error("next card not resolved");
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      expect(app.querySelector(".proposal-onchain")?.textContent || "").not.toContain(ESCROW);
      expect(app.querySelector(".proposal-funding-bar")).toBeNull();
      expect(app.querySelector("[data-open-donate]")).toBeNull();
      const mobile = app.querySelector<HTMLElement>("#mobile-cta-slot");
      if (mobile) expect(mobile.hidden).toBe(true);
      // The refund action is the point of a refunding page. With
      // accepting_funds:false main still exits early ("Structure unavailable");
      // plebly.fund#69 keeps Register there too.
      if (accepting) expect(app.querySelector("#next-register")).toBeTruthy();
    });
  }
});
