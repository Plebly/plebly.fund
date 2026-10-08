/**
 * UI UX condition on plebly.fund#74: the page never draws a funding meter when
 * it doesn't know the balance. Before: a row missing from the catalog became
 * shared, balanceAddressFor returned null, balance stayed undefined and
 * fundingProgressHtml did `balance ?? 0`, so the hero said 0 raised and the full
 * floor "to open" (BeTheChange777's report). Unknown covers: missing catalog row,
 * shared with balance_sats:null, mempool error, and the 2.5s mempool timeout.
 * A known 0 is a real balance and still draws the meter.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAIM_FLOOR_SATS } from "./config";
import {
  fundingProgressHtml,
  isKnownBalance,
  proposalFundingBarHtml,
  updateProposalFundingBar,
} from "./proposal-funding-bar";
import type { Proposal } from "./types";

const SHARED = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const UNIQUE = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const UNAVAILABLE = "Balance temporarily unavailable";

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
    ...over,
  } as Proposal;
}

function el(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

function expectNoMeter(root: ParentNode): void {
  expect(root.querySelector(".proposal-funding-bar")).toBeNull();
  expect(root.querySelector(".funding-meter")).toBeNull();
  expect((root as HTMLElement).textContent || "").not.toMatch(/to open/i);
  expect(root.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
}

describe("funding bar helpers: unknown balance draws no meter", () => {
  const ctx = { status: "listed", claimer: null, proposal_type: "bounty" };

  it("isKnownBalance: only finite numbers (0 included)", () => {
    expect(isKnownBalance(0)).toBe(true);
    expect(isKnownBalance(36_030)).toBe(true);
    expect(isKnownBalance(undefined)).toBe(false);
    expect(isKnownBalance(null)).toBe(false);
    expect(isKnownBalance(Number.NaN)).toBe(false);
  });

  for (const [label, balance] of [
    ["undefined", undefined],
    ["null", null],
    ["NaN", Number.NaN],
  ] as const) {
    it(`proposalFundingBarHtml(${label}): no bar, no "to open", unavailable line`, () => {
      expectNoMeter(el(proposalFundingBarHtml(balance, CLAIM_FLOOR_SATS, 100_000, [], ctx)));
    });
    it(`fundingProgressHtml(${label}): no meter either (any other caller)`, () => {
      expectNoMeter(el(fundingProgressHtml(balance, CLAIM_FLOOR_SATS, 100_000, [], ctx)));
    });
  }

  it("control: known 0 still draws the meter with 'to open'", () => {
    const root = el(proposalFundingBarHtml(0, CLAIM_FLOOR_SATS, 100_000, [], ctx));
    expect(root.querySelector(".proposal-funding-bar .funding-meter")).toBeTruthy();
    expect(root.textContent).toMatch(/to open/);
    expect(root.querySelector(".funding-balance-unknown")).toBeNull();
  });

  it("closed status still renders nothing (unchanged), known or unknown", () => {
    expect(proposalFundingBarHtml(undefined, CLAIM_FLOOR_SATS, null, [], { status: "declined" })).toBe("");
    expect(proposalFundingBarHtml(5, CLAIM_FLOOR_SATS, null, [], { status: "declined" })).toBe("");
  });

  it("updateProposalFundingBar ignores a non-finite balance and never adds a bar", () => {
    const root = el(proposalFundingBarHtml(1_000, CLAIM_FLOOR_SATS, null, [], ctx));
    const before = root.innerHTML;
    updateProposalFundingBar(root, Number.NaN, CLAIM_FLOOR_SATS, null, [], ctx);
    expect(root.innerHTML).toBe(before);
    const unknown = el(proposalFundingBarHtml(undefined, CLAIM_FLOOR_SATS, null, [], ctx));
    updateProposalFundingBar(unknown, 5_000, CLAIM_FLOOR_SATS, null, [], ctx);
    expectNoMeter(unknown);
  });
});

describe("proposal page hero: unknown balance paths", () => {
  let addressHits: string[] = [];
  type Mempool = "ok-0" | "500" | "pending";

  function stubFetch(mempool: Mempool) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const m = url.match(/\/address\/([^/?]+)$/);
        if (m) {
          addressHits.push(decodeURIComponent(m[1]!));
          if (mempool === "pending") return new Promise<Response>(() => undefined);
          if (mempool === "500") return new Response("{}", { status: 500 });
          return Response.json({
            chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
            mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          });
        }
        // Everything else (claim view, catalog, comments …) never answers:
        // this checks first paint only.
        return new Promise<Response>(() => undefined);
      }),
    );
  }

  async function paint(p: Proposal, mempool: Mempool, timeout = 1_000): Promise<HTMLElement> {
    document.body.innerHTML = `<div id="app"></div>`;
    stubFetch(mempool);
    const { renderProposalPage } = await import("./proposal-page");
    void renderProposalPage(p.path, (inner) => inner, null, () => undefined, {
      ...p,
      endowment_funded: false,
    });
    const app = document.querySelector<HTMLElement>("#app")!;
    await vi.waitFor(
      () => {
        if (!app.querySelector(".proposal-hero")) throw new Error("not painted yet");
      },
      { timeout },
    );
    return app;
  }

  // Warm the page module graph once so the first cold import can't hit the 5s timeout.
  beforeAll(async () => {
    await import("./proposal-page");
  }, 30_000);
  beforeEach(() => {
    addressHits = [];
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  it("shared row with balance_sats:null: no meter, no address read", async () => {
    const app = await paint(
      row({ escrow_address: SHARED, escrow_shared: true, balance_sats: null as unknown as undefined }),
      "ok-0",
    );
    expect(addressHits).not.toContain(SHARED);
    expectNoMeter(app);
  });

  it("unique row, mempool read errors: no meter", async () => {
    const app = await paint(row({ balance_sats: undefined }), "500");
    expect(addressHits).toContain(UNIQUE);
    expectNoMeter(app);
  });

  it("unique row, mempool read hangs past the 2.5s timeout: no meter", async () => {
    const app = await paint(row({ balance_sats: undefined }), "pending", 5_000);
    expect(addressHits).toContain(UNIQUE);
    expectNoMeter(app);
  }, 10_000);

  it("control: unique row whose mempool read returns 0 draws the meter", async () => {
    const app = await paint(row({ balance_sats: undefined }), "ok-0");
    expect(app.querySelector(".proposal-funding-bar .funding-meter")).toBeTruthy();
    expect(app.querySelector(".funding-balance-unknown")).toBeNull();
  });

  it("control: catalog balance_sats 0 (shared row's own funding) draws the meter", async () => {
    const app = await paint(
      row({ escrow_address: SHARED, escrow_shared: true, balance_sats: 0 }),
      "ok-0",
    );
    expect(app.querySelector(".proposal-funding-bar .funding-meter")).toBeTruthy();
    expect(addressHits).not.toContain(SHARED);
  });
});

describe("home card: own-address row whose balance read failed", () => {
  async function card(p: Proposal) {
    const { proposalCardHtml } = await import("./home-page");
    return el(proposalCardHtml(p, CLAIM_FLOOR_SATS, false, false));
  }

  it("fundable: unavailable line, no sats line, no bar, no 'to open'", async () => {
    const c = await card(row({ balance_sats: undefined }));
    expect(c.querySelector(".funding-balance-unknown")?.textContent).toBe(UNAVAILABLE);
    expect(c.querySelector(".project-card-meter .sats")).toBeNull();
    expect(c.querySelector(".proposal-progress, .funding-bar-track, [class*='progress']")).toBeNull();
    expect(c.textContent).not.toMatch(/to open|\b0 sats\b/);
  });

  it("terminal (completed/declined/voided): no balance line at all", async () => {
    for (const status of ["completed", "declined", "voided"]) {
      const c = await card(row({ status, balance_sats: undefined } as Partial<Proposal>));
      expect(c.querySelector(".project-card-meter")).toBeNull();
    }
  });

  it("control: known 0 still draws the card meter", async () => {
    const c = await card(row({ balance_sats: 0 }));
    expect(c.querySelector(".project-card-meter .sats")).toBeTruthy();
    expect(c.textContent).toMatch(/to open/);
  });
});
