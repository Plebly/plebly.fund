/**
 * Review on plebly.fund#74 @ 1822fb7: after the claim view allows Donate,
 * builder-panel re-inserts `#onchain-escrow-row` (builder-panel.ts ~1561-1563)
 * only for a real string address on this network (`escrowAddressText` +
 * `escrowAddressMatchesNetwork`).
 *
 * What reaches that check: `applyClaimStatusToProposal` merges the claim view
 * into the proposal first (`escrow_address: status.escrow_address ||
 * proposal.escrow_address`), and `donateAllowed` already needs the claim view's
 * own non-blank string `escrow_address`. So whenever the re-insert runs, its
 * address is the claim view's string, never the doc's or catalog's value.
 * `isClaimViewDonateAllowed` does not check the network, so a claim view
 * carrying a mainnet address opens the gate and only the network check keeps
 * the row out. The string check is what trims a padded claim-view address.
 *
 * Doc/catalog sources: rows are shared (catalog `escrow_shared: true`) or
 * missing from the catalog (treated as shared). A non-shared row with a
 * non-string address never gets this far: `balanceAddressFor` throws and the
 * page shows "Could not load proposal" (pre-existing on main; see the PR body).
 *
 * Two flows:
 * - "first load": the claim view answers on the first read.
 * - "after Retry": the first claim-view read fails (builder-panel removes any
 *   escrow row and shows Retry), then Retry succeeds, so the row can only come
 *   back through the re-insert.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { BITCOIN_NETWORK, CLAIM_FLOOR_SATS } from "./config";

/** The claim view's own address (valid signet). */
const CLAIM_ADDR = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
/** Valid signet address in the git doc. */
const DOC_ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
/** Valid signet address in the catalog row. */
const CATALOG_ADDR = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
/** Well-formed mainnet address: the wrong network for this signet build. */
const MAINNET_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const ID = "PLEBLY-2026-077";
const PATH = "proposals/listed/PLEBLY-2026-077.md";

/** `escrowYaml` is the raw frontmatter value, so 123, {} and [..] parse as non-strings. */
function markdown(escrowYaml: string): string {
  return `---
id: ${ID}
title: "Escrow row bounty"
status: listed
target_sats: 1500000
escrow_address: ${escrowYaml}
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

function claimView(status: string, escrow: string): Partial<ClaimStatus> {
  return {
    proposal_id: ID,
    proposal_path: PATH,
    state: "open",
    status,
    confirmed_balance_sats: 0,
    claim_floor_sats: CLAIM_FLOOR_SATS,
    escrow_address: escrow,
    accepting_funds: true,
  };
}

/** Shared catalog row in `claimable` (differs from the doc's `listed`), so its escrow_address applies. */
function sharedCatalogRow(escrow: unknown): Record<string, unknown> {
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

/** Some other proposal, so the catalog is readable but this row is missing. */
const OTHER_ROW = {
  id: "PLEBLY-2026-011",
  path: "proposals/completed/PLEBLY-2026-011.md",
  title: "Other",
  status: "completed",
  proposal_type: "bounty",
  escrow_address: "tb1qother0000000000000000000000000000000",
  balance_sats: 0,
};

type Source = {
  docEscrow: string;
  catalog: Record<string, unknown>[];
  claimStatus: string;
  /** The claim view's escrow_address (it always says accepting_funds: true). */
  claimEscrow: string;
};

/** The address comes from the git doc; no catalog row (treated as shared). */
function fromDoc(yaml: string, claimEscrow = CLAIM_ADDR): Source {
  return { docEscrow: yaml, catalog: [OTHER_ROW], claimStatus: "listed", claimEscrow };
}

/** The address comes from a shared catalog row whose lifecycle overlay applies. */
function fromCatalog(value: unknown, claimEscrow = CLAIM_ADDR): Source {
  return {
    docEscrow: `"${DOC_ADDR}"`,
    catalog: [OTHER_ROW, sharedCatalogRow(value)],
    claimStatus: "claimable",
    claimEscrow,
  };
}

let claimFails = false;

function stubFetch(src: Source) {
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
        if (claimFails) return new Response("{}", { status: 500 });
        return Response.json(claimView(src.claimStatus, src.claimEscrow));
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

function visible(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && n.hidden) return false;
  }
  return true;
}

function donateShown(app: HTMLElement): boolean {
  return [...app.querySelectorAll("[data-open-donate]")].some(visible);
}

async function donateResolved(app: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    const s = app.querySelector("#next-card-sentence")?.textContent || "";
    if (!s || s === "…") throw new Error("next card not resolved");
    if (app.querySelector("#donate-loading")) throw new Error("donate slot still loading");
    if (!donateShown(app)) throw new Error("Donate not shown yet");
  });
  await new Promise((r) => setTimeout(r, 0));
}

/** /p/{id} the way main.ts loads it; returns once the claim view (or Retry) has been applied. */
async function renderPage(src: Source, flow: "first load" | "after Retry"): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  claimFails = flow === "after Retry";
  stubFetch(src);
  const { renderProposalPage } = await import("./proposal-page");
  const { findListedProposalById } = await import("./github");
  const preloaded = await findListedProposalById(ID);
  expect(preloaded?.path).toBe(PATH);
  expect(preloaded?.escrow_shared).toBe(true);
  void renderProposalPage(PATH, (inner) => inner, null, () => undefined, preloaded);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-sidebar")) throw new Error("not painted yet");
  });
  if (flow === "after Retry") {
    await vi.waitFor(() => {
      if (!app.querySelector("#builder-status-retry")) throw new Error("no Retry yet");
    });
    expect(app.querySelector("#onchain-escrow-row")).toBeNull();
    claimFails = false;
    app.querySelector<HTMLButtonElement>("#builder-status-retry")!.click();
  }
  await donateResolved(app);
  return app;
}

function onchainHtml(app: HTMLElement): string {
  return app.querySelector(".proposal-onchain")?.innerHTML || "";
}

beforeAll(async () => {
  await import("./proposal-page");
  await import("./github");
}, 30_000);
beforeEach(() => {
  claimFails = false;
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

/** The re-inserted row shows exactly `addr`: code text, explorer link and Copy. */
function expectRowExactly(app: HTMLElement, addr: string): void {
  const row = app.querySelector<HTMLElement>("#onchain-escrow-row");
  expect(row).toBeTruthy();
  expect(row!.querySelector("code")?.textContent).toBe(addr);
  expect(row!.querySelector<HTMLElement>(".copy-btn")?.dataset.escrowCopy).toBe(addr);
  expect(row!.querySelector<HTMLAnchorElement>(".explorer-link")?.getAttribute("href")).toBe(
    `https://mempool.space/signet/address/${addr}`,
  );
}

const NON_STRINGS: [string, string, unknown][] = [
  ["number 123", "123", 123],
  ["object {}", "{}", {}],
  // String([addr]) is a valid signet address.
  ["array holding a valid signet address", `["${DOC_ADDR}"]`, [CATALOG_ADDR]],
];

for (const flow of ["first load", "after Retry"] as const) {
  describe(`${flow}: control, a valid signet claim-view address is re-inserted`, () => {
    it("doc (signet) source → the row shows the claim view's address", async () => {
      const app = await renderPage(fromDoc(`"${DOC_ADDR}"`), flow);
      expectRowExactly(app, CLAIM_ADDR);
    });

    it("catalog (signet) source → the row shows the claim view's address", async () => {
      const app = await renderPage(fromCatalog(CATALOG_ADDR), flow);
      expectRowExactly(app, CLAIM_ADDR);
      expect(onchainHtml(app)).not.toContain(CATALOG_ADDR);
    });
  });

  describe(`${flow}: network check, a mainnet bc1… claim-view address on signet renders no escrow row`, () => {
    it("doc (signet) source", async () => {
      const app = await renderPage(fromDoc(`"${DOC_ADDR}"`, MAINNET_ADDR), flow);
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      expect(onchainHtml(app)).not.toContain(MAINNET_ADDR);
    });

    it("catalog (signet) source", async () => {
      const app = await renderPage(fromCatalog(CATALOG_ADDR, MAINNET_ADDR), flow);
      expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      expect(onchainHtml(app)).not.toContain(MAINNET_ADDR);
    });
  });

  describe(`${flow}: string check, the row uses the trimmed string`, () => {
    it("padded claim-view address → the row shows it trimmed (text, explorer link, Copy)", async () => {
      const app = await renderPage(fromDoc(`"${DOC_ADDR}"`, `  ${CLAIM_ADDR}  `), flow);
      expectRowExactly(app, CLAIM_ADDR);
    });
  });

  describe(`${flow}: a non-string doc/catalog escrow_address never renders`, () => {
    for (const [label, yaml, value] of NON_STRINGS) {
      for (const source of ["doc", "catalog"] as const) {
        const src = (claimEscrow: string) =>
          source === "doc" ? fromDoc(yaml, claimEscrow) : fromCatalog(value, claimEscrow);
        const expectNothingFromIt = (app: HTMLElement) => {
          const html = onchainHtml(app);
          expect(html).not.toContain("[object Object]");
          expect(html).not.toContain(DOC_ADDR);
          expect(html).not.toContain(CATALOG_ADDR);
          expect(app.querySelector(".proposal-onchain")?.textContent || "").not.toMatch(/\b123\b/);
        };

        it(`${label} from the ${source} + signet claim view → only the claim view's address`, async () => {
          const app = await renderPage(src(CLAIM_ADDR), flow);
          expectRowExactly(app, CLAIM_ADDR);
          expectNothingFromIt(app);
        });

        it(`${label} from the ${source} + mainnet claim view → no #onchain-escrow-row`, async () => {
          const app = await renderPage(src(MAINNET_ADDR), flow);
          expect(app.querySelector("#onchain-escrow-row")).toBeNull();
          expect(onchainHtml(app)).not.toContain(MAINNET_ADDR);
          expectNothingFromIt(app);
        });
      }
    }
  });
}
