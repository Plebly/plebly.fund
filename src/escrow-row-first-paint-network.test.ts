/**
 * First paint of the on-chain panel (`onChainPanelHtml`) only shows an escrow
 * address on this network. A wrong-network address (bc1… on this signet
 * build) from the git doc or the catalog must not appear on first paint, and
 * must not stay once the claim view allows Donate: the row then shows the
 * claim view's own (signet) address.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { BITCOIN_NETWORK, CLAIM_FLOOR_SATS } from "./config";
import { onChainPanelHtml } from "./proposal-ui";
import type { Proposal } from "./types";

const CLAIM_ADDR = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
const DOC_ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const MAINNET_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const ID = "PLEBLY-2026-077";
const PATH = "proposals/listed/PLEBLY-2026-077.md";

function markdown(escrow: string): string {
  return `---
id: ${ID}
title: "Escrow row bounty"
status: listed
target_sats: 1500000
escrow_address: "${escrow}"
escrow_index: 1
submission_fee_txid: "${"ab".repeat(32)}"
proposer:
  username: secsovereign
  github: null
  nostr: null
created_at: "2026-07-25T00:00:00Z"
---

# Escrow row

## Problem

Body.
`;
}

const OTHER_ROW = {
  id: "PLEBLY-2026-011",
  path: "proposals/completed/PLEBLY-2026-011.md",
  title: "Other",
  status: "completed",
  proposal_type: "bounty",
  escrow_address: "tb1qother0000000000000000000000000000000",
  balance_sats: 0,
};

function catalogRow(escrow: string): Record<string, unknown> {
  return {
    id: ID,
    path: PATH,
    title: "Escrow row bounty",
    status: "claimable",
    proposal_type: "bounty",
    target_sats: 1_500_000,
    escrow_address: escrow,
    escrow_shared: true,
    balance_sats: 0,
  };
}

type Source = { docEscrow: string; catalog: Record<string, unknown>[]; claimStatus: string };
type Claim = "allows" | "pending" | "blocked";

const fromDoc = (addr: string): Source => ({ docEscrow: addr, catalog: [OTHER_ROW], claimStatus: "listed" });
const fromCatalog = (addr: string): Source => ({
  docEscrow: DOC_ADDR,
  catalog: [OTHER_ROW, catalogRow(addr)],
  claimStatus: "claimable",
});

function stubFetch(src: Source, claim: Claim) {
  const md = markdown(src.docEscrow);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.includes("/proposals/catalog")) {
        return Response.json({ scope: "listed", updated_at: "x", proposals: src.catalog });
      }
      if (url.includes("/proposals/doc/")) return Response.json({ markdown: md, path: PATH });
      if (url.includes("/proposals/lookup/")) return Response.json({ path: null, found: false });
      if (url.includes("raw.githubusercontent.com")) return new Response(md, { status: 200 });
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        if (claim === "pending") return new Promise<Response>(() => undefined);
        const view: Partial<ClaimStatus> = {
          proposal_id: ID,
          proposal_path: PATH,
          state: "open",
          status: src.claimStatus,
          confirmed_balance_sats: 0,
          claim_floor_sats: CLAIM_FLOOR_SATS,
          escrow_address: CLAIM_ADDR,
          accepting_funds: claim === "allows",
        };
        return Response.json(view);
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

async function renderPage(src: Source, claim: Claim): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  stubFetch(src, claim);
  const { renderProposalPage } = await import("./proposal-page");
  const { findListedProposalById } = await import("./github");
  const preloaded = await findListedProposalById(ID);
  expect(preloaded?.path).toBe(PATH);
  void renderProposalPage(PATH, (inner) => inner, null, () => undefined, preloaded);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-onchain")) throw new Error("not painted yet");
  });
  if (claim === "allows") {
    await vi.waitFor(() => {
      if (!app.querySelector("#onchain-escrow-row")) throw new Error("no escrow row yet");
    });
  } else if (claim === "blocked") {
    await vi.waitFor(() => {
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("next card not resolved");
    });
  }
  await new Promise((r) => setTimeout(r, 20));
  return app;
}

function onchain(app: HTMLElement): string {
  return app.querySelector(".proposal-onchain")?.innerHTML || "";
}

beforeAll(async () => {
  await import("./proposal-page");
  await import("./github");
}, 30_000);
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

it("the build under test is signet", () => {
  expect(BITCOIN_NETWORK).toBe("signet");
});

describe("onChainPanelHtml (first paint)", () => {
  const base = {
    id: ID,
    path: PATH,
    title: "t",
    status: "listed",
    submission_fee_txid: "ab".repeat(32),
  } as unknown as Proposal;

  it("paints a signet escrow address", () => {
    const html = onChainPanelHtml({ ...base, escrow_address: DOC_ADDR });
    expect(html).toContain('id="onchain-escrow-row"');
    expect(html).toContain(DOC_ADDR);
  });

  it("does not paint a mainnet bc1… address on signet (the rest of the panel stays)", () => {
    const html = onChainPanelHtml({ ...base, escrow_address: MAINNET_ADDR });
    expect(html).not.toContain("onchain-escrow-row");
    expect(html).not.toContain(MAINNET_ADDR);
    expect(html).toContain("Submission fee");
  });

  it("hideEscrow still hides a signet address", () => {
    expect(onChainPanelHtml({ ...base, escrow_address: DOC_ADDR }, { hideEscrow: true })).not.toContain(DOC_ADDR);
  });
});

for (const [label, src] of [
  ["doc", fromDoc(MAINNET_ADDR)],
  ["catalog", fromCatalog(MAINNET_ADDR)],
] as const) {
  describe(`proposal page, bc1… escrow from the ${label}`, () => {
    it("first paint (claim view not back yet): no bc1… address, no escrow row", async () => {
      const app = await renderPage(src, "pending");
      expect(onchain(app)).not.toContain(MAINNET_ADDR);
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    });

    it("claim view allows Donate: the row shows only the claim view's signet address", async () => {
      const app = await renderPage(src, "allows");
      const row = app.querySelector<HTMLElement>("#onchain-escrow-row")!;
      expect(row.querySelector("code")?.textContent).toBe(CLAIM_ADDR);
      expect(row.querySelector<HTMLElement>(".copy-btn")?.dataset.copy).toBe(CLAIM_ADDR);
      expect(app.querySelectorAll("#onchain-escrow-row")).toHaveLength(1);
      expect(onchain(app)).not.toContain(MAINNET_ADDR);
    });

    it("claim view blocks Donate: no escrow row, no bc1… address", async () => {
      const app = await renderPage(src, "blocked");
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      expect(onchain(app)).not.toContain(MAINNET_ADDR);
    });
  });
}

describe("control: a signet doc address is unchanged", () => {
  it("claim view allows Donate: the row shows the claim view's address", async () => {
    const app = await renderPage(fromDoc(DOC_ADDR), "allows");
    expect(app.querySelector("#onchain-escrow-row code")?.textContent).toBe(CLAIM_ADDR);
  });
});
