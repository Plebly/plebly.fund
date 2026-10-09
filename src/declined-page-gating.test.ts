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
    // The claim view's own escrow: without it Donate is closed anyway, which
    // would make the catalog-status gates below untestable.
    escrow_address: ESCROW,
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

async function renderPage(p: Proposal, claim: ClaimStatus | null, search = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  history.replaceState(null, "", `/p/plebly-signet-demo${search}`);
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

/** Next card resolved from the claim view, plus a tick for builder-panel's chrome pass. */
async function settled(app: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    const s = app.querySelector("#next-card-sentence")?.textContent || "";
    if (!s || s === "…") throw new Error("next card not resolved");
  });
  await new Promise((r) => setTimeout(r, 20));
}

/** No Donate anywhere: no button, no modal, no address in the DOM, mobile CTA hidden. */
function assertNoDonate(app: HTMLElement): void {
  expect(app.querySelector("[data-open-donate]")).toBeNull();
  expect(document.querySelector("#donate-modal")).toBeNull();
  expect(document.body.innerHTML).not.toContain(ESCROW);
  const mobile = app.querySelector<HTMLElement>("#mobile-cta-slot");
  if (mobile) expect(mobile.hidden).toBe(true);
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  history.replaceState(null, "", "/");
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
  it("fails closed: unknown, empty, null and malformed (untrimmed / mixed-case) statuses are closed", () => {
    for (const s of ["weird_status", "", "  ", " declined", "declined ", " listed", "Listed", null, undefined]) {
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

  it("catalog declined wins over a claim view that says listed: no address, no Donate", async () => {
    const app = await renderPage(row(), claimView({ status: "listed", state: "open", accepting_funds: true }));
    await settled(app);
    expect(app.querySelector(".proposal-onchain .onchain-panel")).toBeTruthy();
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(app.querySelector(".proposal-onchain")?.textContent || "").not.toContain(ESCROW);
    expect(app.querySelector("[data-open-donate]")).toBeNull();
  });

  it("pooling structure (claimed + awaiting_funds) on a declined row does not bring Donate or the address back", async () => {
    const app = await renderPage(
      row(),
      claimView({
        status: "declined",
        state: "claimed",
        claimer: "bob",
        accepting_funds: true,
        psbt: { structured_state: "awaiting_funds" } as ClaimStatus["psbt"],
      }),
    );
    await settled(app);
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

/**
 * Review HOLD H1 on 8c61359: a catalog-closed row whose claim view says
 * listed (or claimed + awaiting_funds) got a next-card Donate, and clicking it
 * mounted the modal with the address. The next card is now built from the
 * catalog status, and mounting/opening the modal refuses.
 */
describe("catalog-closed row, claim view open (H1): next card from the catalog status; no Donate, modal or address", () => {
  const shapes: Record<string, Partial<ClaimStatus>> = {
    "claim view listed/open": { status: "listed", state: "open", accepting_funds: true },
    "claim view claimed + awaiting_funds": {
      status: "listed",
      state: "claimed",
      claimer: "bob",
      accepting_funds: true,
      psbt: { structured_state: "awaiting_funds" } as ClaimStatus["psbt"],
    },
  };
  for (const catalog of ["declined", "refunding"]) {
    for (const [shape, cv] of Object.entries(shapes)) {
      it(`${catalog} + ${shape}: card matches the catalog-status card, no Donate button`, async () => {
        const claim = claimView(cv);
        const app = await renderPage(row({ status: catalog }), claim);
        await settled(app);
        const { resolveNextAction } = await import("./next-action");
        const expected = resolveNextAction({
          proposal: row({ status: catalog }),
          claim,
          apps: null,
          user: null,
          reviewerActive: false,
          isProposer: false,
          isBuilder: false,
        });
        // Same card as resolveNextAction gives for the catalog status. On main a
        // declined row still falls through to the generic fallback copy;
        // plebly.fund#71 adds "Listing declined." (merge after #71).
        expect(app.querySelector("#next-card-sentence")?.textContent?.trim()).toBe(expected.sentence);
        assertNoDonate(app);
      });

      it(`${catalog} + ${shape}: a Donate click path (stale button) refuses: no modal, no address`, async () => {
        const app = await renderPage(row({ status: catalog }), claimView(cv));
        await settled(app);
        // A stale/injected Donate trigger still goes through the click path.
        app.insertAdjacentHTML("beforeend", `<button type="button" data-open-donate id="stale-donate">Donate</button>`);
        const { ensureDonateModalMounted } = await import("./proposal-ui");
        expect(await ensureDonateModalMounted(document)).toBeNull();
        document.querySelector<HTMLButtonElement>("#stale-donate")!.click();
        await new Promise((r) => setTimeout(r, 50));
        expect(document.querySelector("#donate-modal:not([data-donate-shell])")).toBeNull();
        expect(document.body.innerHTML).not.toContain(ESCROW);
      });
    }

    it(`${catalog} + claim view listed + ?donate deep link: no auto-open, no modal, no address`, async () => {
      const app = await renderPage(
        row({ status: catalog }),
        claimView({ status: "listed", state: "open", accepting_funds: true }),
        "?donate=1",
      );
      await settled(app);
      await new Promise((r) => setTimeout(r, 50));
      assertNoDonate(app);
    });
  }

  it("control: catalog listed + claim view listed keeps Donate and opens the modal on the claim-view address", async () => {
    const app = await renderPage(
      row({ status: "listed" }),
      claimView({ status: "listed", state: "open", accepting_funds: true }),
    );
    await settled(app);
    const btn = app.querySelector<HTMLButtonElement>("[data-open-donate]");
    expect(btn).toBeTruthy();
    btn!.click();
    await vi.waitFor(() => {
      if (!document.querySelector("#donate-modal")) throw new Error("modal not mounted");
    });
    expect(document.querySelector("#donate-modal")!.innerHTML).toContain(ESCROW);
  });
});

/** Review HOLD H2: unknown or malformed status strings fail closed. */
describe("unknown or malformed catalog status (H2): 'Funding status unavailable.', nothing fundable", () => {
  for (const status of ["weird_status", "", " declined", "Listed"]) {
    it(`status ${JSON.stringify(status)}: first paint and after the claim view, no address, meter or Donate`, async () => {
      const app = await renderPage(row({ status }), claimView({ status: "listed", state: "open", accepting_funds: true }));
      expect(app.querySelector(".proposal-funding-bar")).toBeNull();
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      await settled(app);
      expect(app.querySelector("#next-card-sentence")?.textContent?.trim()).toBe("Funding status unavailable.");
      expect(app.querySelector(".next-card-primary button, .next-card-primary a")).toBeNull();
      expect(app.querySelector(".proposal-funding-bar")).toBeNull();
      assertNoDonate(app);
    });
  }

  it("copy: 'Funding status unavailable.', never 'isn't accepting funds', no button", async () => {
    const { resolveNextAction, nextActionCardHtml } = await import("./next-action");
    for (const status of ["weird_status", "", " declined"]) {
      const action = resolveNextAction({ proposal: row({ status }), claim: null });
      expect(action.sentence).toBe("Funding status unavailable.");
      expect(action.button).toBeNull();
      const html = nextActionCardHtml(action);
      expect(html).toContain("Funding status unavailable.");
      expect(html).not.toMatch(/isn.t accepting funds/i);
      expect(html).not.toContain("data-open-donate");
    }
  });
});
