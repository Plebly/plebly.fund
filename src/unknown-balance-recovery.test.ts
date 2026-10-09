/**
 * UI UX + Review gate on plebly.fund#74 (raised on #88): an unknown balance
 * paints "Balance temporarily unavailable." and no .proposal-funding-bar. A
 * later good read for a NON-shared row (its own address: balance poll /
 * #88's watcher via onBalanceUpdate, or a claim-view refresh with a confirmed
 * balance) must swap that line for the normal meter, the same markup as first
 * paint, and write no "N added" itself. Shared, escrow_shared, missing-row and
 * ambiguous rows (the last two become escrow_shared in
 * applyCatalogRuntimeToProposal) never get a meter.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import { proposalFundingBarHtml, updateProposalFundingBar } from "./proposal-funding-bar";
import type { Proposal } from "./types";

const UNIQUE = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const SHARED = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const UNAVAILABLE = "Balance temporarily unavailable.";
const CTX = { status: "listed", claimer: null, proposal_type: "bounty" as const };

function row(over: Partial<Proposal>): Proposal {
  return {
    id: "PLEBLY-2026-007",
    path: "proposals/listed/PLEBLY-2026-007.md",
    title: "Row",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 100_000,
    escrow_address: UNIQUE,
    submission_fee_txid: "ab".repeat(32),
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "## Summary\n\nBody.",
    endowment_funded: false,
    ...over,
  } as Proposal;
}

function host(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = `<header class="proposal-hero"></header>${html}<nav class="stepper"></nav>`;
  return d;
}

function expectMeter(root: ParentNode, label?: RegExp): void {
  expect(root.querySelector(".proposal-funding-bar .funding-meter")).toBeTruthy();
  expect(root.querySelector(".funding-balance-unknown")).toBeNull();
  expect(root.querySelector(".proposal-funding-unknown")).toBeNull();
  if (label) expect(root.querySelector(".proposal-funding-bar")?.textContent || "").toMatch(label);
}

function expectNoMeter(root: ParentNode): void {
  expect(root.querySelector(".proposal-funding-bar:not([data-shared-pending])")).toBeNull();
  expect(root.querySelector(".funding-meter-goal")).toBeNull();
  expect((root as HTMLElement).textContent || "").not.toMatch(/to open|5,000/i);
}

describe("updateProposalFundingBar on an unknown-balance placeholder", () => {
  it("recoverUnknown (non-shared row): the first-paint meter replaces the line, nothing 'added'", () => {
    const root = host(proposalFundingBarHtml(undefined, CLAIM_FLOOR_SATS, 100_000, [], CTX));
    expect(root.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
    updateProposalFundingBar(root, 5_000, CLAIM_FLOOR_SATS, 100_000, [], CTX, { recoverUnknown: true });
    expectMeter(root, /5,000/);
    const firstPaint = host(proposalFundingBarHtml(5_000, CLAIM_FLOOR_SATS, 100_000, [], CTX));
    expect(root.querySelector(".proposal-funding-bar")!.outerHTML).toBe(
      firstPaint.querySelector(".proposal-funding-bar")!.outerHTML,
    );
    expect(root.textContent || "").not.toMatch(/added/i);
    // Sits where the line was: between the hero and the stepper.
    expect(root.querySelector(".proposal-hero + .proposal-funding-bar + .stepper")).toBeTruthy();
  });

  it("without recoverUnknown (shared / missing / ambiguous row): the line stays, no meter", () => {
    const root = host(proposalFundingBarHtml(undefined, CLAIM_FLOOR_SATS, 100_000, [], CTX));
    updateProposalFundingBar(root, 5_000, CLAIM_FLOOR_SATS, 100_000, [], CTX);
    expectNoMeter(root);
    expect(root.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
  });

  it("a shared row's pending block (#62 data-shared-pending) never becomes a meter", () => {
    const root = host(`<div class="proposal-funding-bar" data-shared-pending="1"><div class="funding-meter"><div class="funding-meter-top"><span class="funding-meter-label muted">Awaiting confirmation</span></div></div></div>`);
    updateProposalFundingBar(root, 5_000, CLAIM_FLOOR_SATS, 100_000, [], CTX);
    updateProposalFundingBar(root, 5_000, CLAIM_FLOOR_SATS, 100_000, [], CTX, { recoverUnknown: true });
    expect(root.querySelector(".funding-meter-label")?.textContent).toBe("Awaiting confirmation");
    expect(root.querySelector(".funding-meter-goal")).toBeNull();
    expect(root.textContent || "").not.toMatch(/5,000|to open/);
  });

  it("recoverUnknown with an unknown value: nothing changes", () => {
    const root = host(proposalFundingBarHtml(undefined, CLAIM_FLOOR_SATS, 100_000, [], CTX));
    updateProposalFundingBar(root, Number.NaN, CLAIM_FLOOR_SATS, 100_000, [], CTX, { recoverUnknown: true });
    expect(root.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
  });

  it("control: a known 0 meter updates in place to the new balance", () => {
    const root = host(proposalFundingBarHtml(0, CLAIM_FLOOR_SATS, 100_000, [], CTX));
    expectMeter(root, /to open/);
    updateProposalFundingBar(root, 5_000, CLAIM_FLOOR_SATS, 100_000, [], CTX);
    expectMeter(root, /5,000/);
  });
});

describe("proposal page: first read fails, a later good read arrives", () => {
  type Mempool = "500" | "ok-0";
  let addressHits: string[] = [];
  let claim: Partial<ClaimStatus> | null = null;

  function stubFetch(mempool: Mempool) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const addr = url.match(/\/address\/([^/?]+)$/);
        if (addr) {
          addressHits.push(decodeURIComponent(addr[1]!));
          if (mempool === "500") return new Response("{}", { status: 500 });
          return Response.json({
            chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          });
        }
        if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
          if (!claim) return new Promise<Response>(() => undefined);
          return Response.json(claim);
        }
        return new Response("{}", { status: 404 });
      }),
    );
  }

  async function paint(p: Proposal, mempool: Mempool): Promise<HTMLElement> {
    document.body.innerHTML = `<div id="app"></div>`;
    stubFetch(mempool);
    const { renderProposalPage } = await import("./proposal-page");
    void renderProposalPage(p.path, (inner) => inner, null, () => undefined, p);
    const app = document.querySelector<HTMLElement>("#app")!;
    await vi.waitFor(() => {
      if (!app.querySelector(".proposal-sidebar")) throw new Error("not painted yet");
    });
    return app;
  }

  /**
   * What #88's watcher (and the Donate panel's balance poll) calls: the
   * onBalanceUpdate on the Donate context's panelOpts, i.e. the opts the real
   * modal is bound with. bindBuilderPanel replaces the page's context (early
   * opts, then claim-view opts), so this is builder-panel's object, not the
   * page's; both must forward the page's hook.
   */
  async function balanceUpdate(next: number, stage: "early" | "claim"): Promise<void> {
    const { getDonateChromeContext } = await import("./proposal-ui");
    const ctx = getDonateChromeContext();
    // builder-panel's contexts carry fundsClosed; the page's own does not.
    expect(ctx && "fundsClosed" in ctx).toBe(true);
    if (stage === "claim") expect(ctx?.claimStatusPromise).toBeTruthy();
    const cb = ctx?.panelOpts.onBalanceUpdate;
    expect(cb).toBeTypeOf("function");
    cb!(next);
  }

  async function claimApplied(app: HTMLElement): Promise<void> {
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("claim view not applied yet");
    });
    await new Promise((r) => setTimeout(r, 20));
  }

  function confirmedClaim(p: Proposal, sats: number): Partial<ClaimStatus> {
    return {
      proposal_id: p.id!,
      proposal_path: p.path,
      state: "open",
      status: "listed",
      accepting_funds: true,
      escrow_address: p.escrow_address,
      confirmed_balance_sats: sats,
      claim_floor_sats: CLAIM_FLOOR_SATS,
      psbt: { structured_state: "confirmed" } as ClaimStatus["psbt"],
    };
  }

  beforeAll(async () => {
    await import("./proposal-page");
  }, 30_000);
  beforeEach(() => {
    addressHits = [];
    claim = null;
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  it("(1) unique row: balance update after a failed first read draws the meter, line gone, no 'added'", async () => {
    const app = await paint(row({ balance_sats: undefined }), "500");
    expect(addressHits).toContain(UNIQUE);
    expect(app.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
    await balanceUpdate(5_000, "early");
    expectMeter(app, /5,000/);
    expect(app.querySelector(".proposal-hero ~ .proposal-funding-bar")).toBeTruthy();
    expect(app.textContent || "").not.toMatch(/added/i);
  });

  it("(1c) unique row: after the claim view loads, a balance update on the modal's opts draws the meter", async () => {
    const p = row({ balance_sats: undefined });
    claim = { ...confirmedClaim(p, 0), psbt: null };
    const app = await paint(p, "500");
    await claimApplied(app);
    expect(app.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
    await balanceUpdate(5_000, "claim");
    expectMeter(app, /5,000/);
    expect(app.textContent || "").not.toMatch(/added/i);
  });

  it("(1b) unique row: a claim-view refresh with a confirmed balance draws the meter", async () => {
    const p = row({ balance_sats: undefined });
    claim = confirmedClaim(p, 5_000);
    const app = await paint(p, "500");
    await vi.waitFor(() => {
      if (!app.querySelector(".proposal-funding-bar .funding-meter")) throw new Error("no meter yet");
    });
    expectMeter(app, /5,000/);
    expect(app.textContent || "").not.toMatch(/added/i);
  });

  for (const [label, p] of [
    ["shared row (escrow_shared, balance null)", row({ escrow_address: SHARED, escrow_shared: true, balance_sats: null as unknown as undefined })],
    ["missing / ambiguous catalog row (escrow_shared from the overlay)", row({ escrow_shared: true, balance_sats: undefined })],
  ] as [string, Proposal][]) {
    it(`(2) ${label}: a balance update never draws a meter`, async () => {
      const app = await paint(p, "500");
      await balanceUpdate(5_000, "early");
      expectNoMeter(app);
    });

    it(`(2c) ${label}: after the claim view loads, a balance update still never draws a meter`, async () => {
      claim = { ...confirmedClaim(p, 0), psbt: null };
      const app = await paint(p, "500");
      await claimApplied(app);
      await balanceUpdate(5_000, "claim");
      expectNoMeter(app);
    });

    it(`(2b) ${label}: a claim-view confirmed balance never draws a meter`, async () => {
      claim = confirmedClaim(p, 5_000);
      const app = await paint(p, "500");
      await claimApplied(app);
      expectNoMeter(app);
    });
  }

  it("(3) control: known 0 draws the meter at first paint, and an update moves it", async () => {
    const app = await paint(row({ balance_sats: undefined }), "ok-0");
    expectMeter(app, /to open/);
    await balanceUpdate(5_000, "early");
    expectMeter(app, /5,000/);
    expect(app.textContent || "").not.toMatch(/added/i);
  });
});
