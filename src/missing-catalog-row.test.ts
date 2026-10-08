/**
 * KNOTS on the live tip (2026-10-08): PLEBLY-KNOTS-SIZE-VALUE-SPAM is missing
 * from the Worker catalog, but its git file is fine. A missing catalog row
 * must not close Donate by itself: the claim view (which reads the git file
 * and fails closed when it can't) decides. Review's three conditions:
 *
 * (a) Donate shows only when the claim view itself returns
 *     `accepting_funds: true`. Missing / errored / false / null claim view
 *     keeps Donate closed, catalog row or not.
 * (b) The address comes from the claim view (or git file), never the catalog.
 *     First paint stays on the placeholder until the claim view arrives.
 * (c) A row missing from the catalog is treated as shared for its balance
 *     (workers#50 fail-closed): no address-total meter. A catalog or claim
 *     view `accepting_funds: false` still closes Donate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";

const KNOTS = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
/** A different (catalog-only) escrow that must never reach the page. */
const CATALOG_ONLY = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const ID = "PLEBLY-KNOTS-SIZE-VALUE-SPAM";
const PATH = "proposals/listed/knots-size-value-spam.md";
/** Address total the mempool would report; a shared/unknown row never shows it. */
const ADDRESS_TOTAL = 777_777;

const MARKDOWN = `---
id: ${ID}
title: "Knots PR: reject high size-to-value relay spam"
status: listed
target_sats: 1500000
escrow_address: "${KNOTS}"
escrow_index: 1
submission_fee_txid: "${"ab".repeat(32)}"
proposer:
  username: secsovereign
  github: null
  nostr: null
created_at: "2026-07-25T00:00:00Z"
---

# Knots PR

## Problem

Body.
`;

type ClaimReply = Partial<ClaimStatus> | "pending" | "404" | "500" | "throw";

function claimView(over: Partial<ClaimStatus> = {}): Partial<ClaimStatus> {
  return {
    proposal_id: ID,
    proposal_path: PATH,
    state: "open",
    status: "listed",
    confirmed_balance_sats: 0,
    claim_floor_sats: CLAIM_FLOOR_SATS,
    escrow_address: KNOTS,
    ...over,
  };
}

let addressHits: string[] = [];

function stubFetch(claim: ClaimReply, catalogRows: Record<string, unknown>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const addr = url.match(/\/address\/([^/?]+)$/);
      if (addr) {
        addressHits.push(decodeURIComponent(addr[1]!));
        return Response.json({
          chain_stats: { funded_txo_sum: ADDRESS_TOTAL, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.includes("/proposals/catalog")) {
        return Response.json({ scope: "listed", updated_at: "x", proposals: catalogRows });
      }
      if (url.includes("/proposals/doc/")) {
        return Response.json({ markdown: MARKDOWN, path: PATH });
      }
      if (url.includes("/proposals/lookup/")) {
        return Response.json({ path: null, found: false });
      }
      if (url.includes("raw.githubusercontent.com")) {
        return new Response(MARKDOWN, { status: 200 });
      }
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        if (claim === "pending") return new Promise<Response>(() => undefined);
        if (claim === "404") return new Response("{}", { status: 404 });
        if (claim === "500") return new Response("{}", { status: 500 });
        if (claim === "throw") throw new TypeError("network");
        return Response.json(claim);
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

/** Catalog row for KNOTS (only for the tests that want one). */
function catalogRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    path: PATH,
    title: "Knots",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 1_500_000,
    escrow_address: KNOTS,
    balance_sats: 0,
    ...over,
  };
}

/** Some other proposal, so the catalog itself is readable but KNOTS isn't in it. */
const OTHER_ROW = catalogRow({
  id: "PLEBLY-2026-011",
  path: "proposals/completed/PLEBLY-2026-011.md",
  status: "completed",
  escrow_address: "tb1qother0000000000000000000000000000000",
});

/**
 * Load the page the way main.ts does. "stable" (/p/{id}, the live KNOTS link):
 * findListedProposalById(id) then renderProposalPage(path, …, proposal).
 * "path" (legacy /proposal/…): renderProposalPage(path) resolves it itself.
 */
async function renderPage(opts: {
  claim: ClaimReply;
  catalog?: Record<string, unknown>[];
  preloaded?: Proposal | null;
  route?: "stable" | "path";
}): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  stubFetch(opts.claim, opts.catalog ?? [OTHER_ROW]);
  const { renderProposalPage } = await import("./proposal-page");
  let preloaded = opts.preloaded ?? null;
  if (!preloaded && (opts.route ?? "stable") === "stable") {
    const { findListedProposalById } = await import("./github");
    preloaded = await findListedProposalById(ID);
    expect(preloaded?.path).toBe(PATH);
  }
  void renderProposalPage(PATH, (inner) => inner, null, () => undefined, preloaded);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-sidebar")) throw new Error("not painted yet");
  });
  return app;
}

/** Wait until bindBuilderPanel has acted on the claim view (or its failure). */
async function claimSettled(app: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    if (app.querySelector("#builder-status-retry")) return;
    const s = app.querySelector("#next-card-sentence")?.textContent || "";
    if (!s || s === "…") throw new Error("next card not resolved");
    if (app.querySelector("#donate-loading")) throw new Error("donate slot still loading");
  });
  await new Promise((r) => setTimeout(r, 0));
}

function visible(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && n.hidden) return false;
  }
  return true;
}

function donateShown(app: HTMLElement): boolean {
  const mobile = app.querySelector<HTMLElement>("#mobile-cta-slot");
  return (
    [...app.querySelectorAll("[data-open-donate]")].some(visible) ||
    Boolean(mobile && !mobile.hidden && mobile.innerHTML.trim())
  );
}

function pageHtml(): string {
  return document.body.innerHTML;
}

beforeEach(() => {
  addressHits = [];
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("(a) missing catalog row: the claim view's accepting_funds decides Donate", () => {
  it("positive: no catalog row + claim view accepting_funds:true + listed → Donate shown", async () => {
    const app = await renderPage({ claim: claimView({ accepting_funds: true }) });
    await claimSettled(app);
    expect(donateShown(app)).toBe(true);
    expect(app.querySelector("#onchain-escrow-row")?.textContent || "").toContain(KNOTS);
  });

  for (const [label, claim] of [
    ["claim view 404 (missing)", "404"],
    ["claim view 500 (errored)", "500"],
    ["claim view network error", "throw"],
    ["claim view accepting_funds:false", claimView({ accepting_funds: false })],
    ["claim view accepting_funds:null (unknown)", claimView({ accepting_funds: null })],
    ["claim view without accepting_funds (unresolved reply shape)", claimView({ accepting_funds: undefined })],
  ] as [string, ClaimReply][]) {
    it(`no catalog row + ${label} → Donate closed, no address`, async () => {
      const app = await renderPage({ claim });
      await claimSettled(app);
      expect(donateShown(app)).toBe(false);
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      expect(document.querySelector("#donate-modal")).toBeNull();
    });
  }

  it("same rule with a catalog row present: accepting_funds:null keeps Donate closed", async () => {
    const app = await renderPage({ claim: claimView({ accepting_funds: null }), catalog: [catalogRow()] });
    await claimSettled(app);
    expect(donateShown(app)).toBe(false);
  });
});

describe("(b) the address comes from the claim view, never the catalog", () => {
  it("first paint (claim view pending): placeholder, no address anywhere on the page", async () => {
    const app = await renderPage({ claim: "pending" });
    await new Promise((r) => setTimeout(r, 20));
    expect(app.querySelector("#donate-slot-pending #donate-loading")).toBeTruthy();
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    expect(pageHtml()).not.toContain(KNOTS);
    expect(donateShown(app)).toBe(false);
  });

  it("catalog row carries a different escrow: the page never shows it, before or after the claim view", async () => {
    // Catalog lifecycle (claimable) differs from the git status, so the catalog
    // overlay applies, including its escrow_address.
    const catalog = [catalogRow({ status: "claimable", escrow_address: CATALOG_ONLY })];
    const app = await renderPage({
      claim: claimView({ status: "claimable", accepting_funds: true, escrow_address: KNOTS }),
      catalog,
    });
    expect(pageHtml()).not.toContain(CATALOG_ONLY);
    await claimSettled(app);
    expect(pageHtml()).not.toContain(CATALOG_ONLY);
    expect(donateShown(app)).toBe(true);
    expect(app.querySelector("#onchain-escrow-row")?.textContent || "").toContain(KNOTS);
    // Donate opens on the claim view's address.
    app.querySelector<HTMLButtonElement>("[data-open-donate]")!.click();
    await vi.waitFor(() => {
      if (!document.querySelector("#donate-modal")) throw new Error("modal not mounted");
    });
    expect(pageHtml()).toContain(KNOTS);
    expect(pageHtml()).not.toContain(CATALOG_ONLY);
  });

  it("claim view says accepting_funds:true but sends no escrow_address: no catalog address, no Donate", async () => {
    const catalog = [catalogRow({ status: "claimable", escrow_address: CATALOG_ONLY })];
    const app = await renderPage({
      claim: claimView({ status: "claimable", accepting_funds: true, escrow_address: null }),
      catalog,
    });
    await claimSettled(app);
    expect(pageHtml()).not.toContain(CATALOG_ONLY);
    expect(donateShown(app)).toBe(false);
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
  });
});

describe("(c) missing catalog row is shared/unknown for its balance; accepting_funds:false still closes", () => {
  it("no catalog row: the page never reads or shows the address total", async () => {
    const app = await renderPage({ claim: claimView({ accepting_funds: true }) });
    await claimSettled(app);
    expect(addressHits).not.toContain(KNOTS);
    expect(app.textContent || "").not.toMatch(/777,777|777777/);
  });

  it("no catalog row, legacy path route: same, never the address total", async () => {
    const app = await renderPage({ claim: claimView({ accepting_funds: true }), route: "path" });
    await claimSettled(app);
    expect(addressHits).not.toContain(KNOTS);
    expect(app.textContent || "").not.toMatch(/777,777|777777/);
    expect(donateShown(app)).toBe(true);
  });

  for (const route of ["stable", "path"] as const) {
    it(`control (${route} route): a unique catalog row (not shared) still reads its address balance`, async () => {
      const app = await renderPage({
        claim: claimView({ accepting_funds: true }),
        catalog: [catalogRow({ balance_sats: undefined })],
        route,
      });
      await claimSettled(app);
      expect(addressHits).toContain(KNOTS);
    });
  }

  it("catalog accepting_funds:false is not overridden by a claim view that says true", async () => {
    const p = { ...(await gitDoc()), accepting_funds: false } as Proposal;
    const app = await renderPage({ claim: claimView({ accepting_funds: true }), preloaded: p });
    await claimSettled(app);
    expect(donateShown(app)).toBe(false);
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
  });

  it("no catalog row + claim view accepting_funds:false → Donate closed", async () => {
    const app = await renderPage({ claim: claimView({ accepting_funds: false }) });
    await claimSettled(app);
    expect(donateShown(app)).toBe(false);
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
  });
});

async function gitDoc(): Promise<Proposal> {
  const { proposalFromMarkdown } = await import("./github");
  return proposalFromMarkdown(MARKDOWN, PATH, "listed");
}
