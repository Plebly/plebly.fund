/**
 * A non-string `escrow_address` (bad doc frontmatter or catalog data: 123,
 * {}, [addr]) on a non-shared row counts as no escrow address: no escrow row
 * from it, no balance read, and the page still loads (it used to show
 * "Could not load proposal").
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import { balanceAddressFor } from "./mempool";
import type { Proposal } from "./types";

const CLAIM_ADDR = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
const SIGNET_ADDR = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const ID = "PLEBLY-2026-078";
const PATH = "proposals/listed/PLEBLY-2026-078.md";

const NON_STRINGS: [string, string, unknown][] = [
  ["number 123", "123", 123],
  ["object {}", "{}", {}],
  ["array holding a valid signet address", `["${SIGNET_ADDR}"]`, [SIGNET_ADDR]],
];

function markdown(escrowYaml: string): string {
  return `---
id: ${ID}
title: "Non-string escrow bounty"
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

# Non-string escrow

## Problem

Body.
`;
}

type Claim = "allows" | "pending" | "blocked";
let addressHits: string[] = [];

function stubFetch(opts: { escrowYaml: string; catalogEscrow: unknown; claim: Claim }) {
  const md = markdown(opts.escrowYaml);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const addr = /\/address\/([^/?]+)$/.exec(url);
      if (addr) {
        addressHits.push(decodeURIComponent(addr[1]!));
        return Response.json({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.includes("/proposals/catalog")) {
        return Response.json({
          scope: "listed",
          updated_at: "x",
          proposals: [
            {
              id: ID,
              path: PATH,
              title: "Non-string escrow bounty",
              status: "listed",
              proposal_type: "bounty",
              target_sats: 1_500_000,
              escrow_address: opts.catalogEscrow,
              escrow_shared: false,
            },
          ],
        });
      }
      if (url.includes("/proposals/doc/")) return Response.json({ markdown: md, path: PATH });
      if (url.includes("/proposals/lookup/")) return Response.json({ path: null, found: false });
      if (url.includes("raw.githubusercontent.com")) return new Response(md, { status: 200 });
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        if (opts.claim === "pending") return new Promise<Response>(() => undefined);
        const view: Partial<ClaimStatus> = {
          proposal_id: ID,
          proposal_path: PATH,
          state: "open",
          status: "listed",
          confirmed_balance_sats: 0,
          claim_floor_sats: CLAIM_FLOOR_SATS,
          escrow_address: CLAIM_ADDR,
          accepting_funds: opts.claim === "allows",
        };
        return Response.json(view);
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

async function paint(preloaded: Proposal, claim: Claim): Promise<HTMLElement> {
  const { renderProposalPage } = await import("./proposal-page");
  void renderProposalPage(PATH, (inner) => inner, null, () => undefined, preloaded);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (/Could not load proposal/.test(app.textContent || "")) return;
    if (!app.querySelector(".proposal-onchain")) throw new Error("not painted yet");
  });
  if (claim === "allows") {
    await vi.waitFor(() => {
      if (/Could not load proposal/.test(app.textContent || "")) return;
      if (!app.querySelector("#onchain-escrow-row")) throw new Error("no escrow row yet");
    });
  } else if (claim === "blocked") {
    await vi.waitFor(() => {
      if (/Could not load proposal/.test(app.textContent || "")) return;
      const s = app.querySelector("#next-card-sentence")?.textContent || "";
      if (!s || s === "…") throw new Error("next card not resolved");
    });
  }
  await new Promise((r) => setTimeout(r, 20));
  return app;
}

beforeAll(async () => {
  await import("./proposal-page");
  await import("./github");
}, 30_000);
beforeEach(() => {
  addressHits = [];
  vi.resetModules();
  document.body.innerHTML = `<div id="app"></div>`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("balanceAddressFor", () => {
  for (const [label, , value] of NON_STRINGS) {
    it(`${label}: null, no throw`, () => {
      const p = { escrow_address: value as string, escrow_shared: false };
      expect(() => balanceAddressFor(p)).not.toThrow();
      expect(balanceAddressFor(p)).toBeNull();
      expect(balanceAddressFor({ escrow_address: value as string })).toBeNull();
    });
  }
  it("a string address is still read (trimmed); shared and blank are still null", () => {
    expect(balanceAddressFor({ escrow_address: ` ${SIGNET_ADDR} `, escrow_shared: false })).toBe(SIGNET_ADDR);
    expect(balanceAddressFor({ escrow_address: SIGNET_ADDR, escrow_shared: true })).toBeNull();
    expect(balanceAddressFor({ escrow_address: "  " })).toBeNull();
    expect(balanceAddressFor({ escrow_address: null })).toBeNull();
  });
});

describe("home/stats enrichBalances", () => {
  it("a non-string row is left as is, no address read, no throw", async () => {
    stubFetch({ escrowYaml: "123", catalogEscrow: 123, claim: "pending" });
    for (const mod of ["./home-page", "./stats-page"] as const) {
      const { enrichBalances } = await import(mod);
      const bad = { id: ID, escrow_address: 123, escrow_shared: false } as unknown as Proposal;
      await expect(enrichBalances([bad])).resolves.toEqual([bad]);
    }
    expect(addressHits).toEqual([]);
  });
});

for (const [label, yaml, value] of NON_STRINGS) {
  describe(`proposal page, non-shared row, escrow ${label}`, () => {
    for (const source of ["doc + catalog", "preloaded row"] as const) {
      async function preloaded(claim: Claim): Promise<Proposal> {
        stubFetch({ escrowYaml: yaml, catalogEscrow: value, claim });
        if (source === "preloaded row") {
          return {
            id: ID,
            path: PATH,
            title: "Non-string escrow bounty",
            status: "listed",
            proposal_type: "bounty",
            target_sats: 1_500_000,
            escrow_address: value,
            escrow_shared: false,
            escrow_index: 1,
            submission_fee_txid: "ab".repeat(32),
            created_at: "2026-07-25T00:00:00Z",
            milestones: [],
            body: "## Problem\n\nBody.",
          } as unknown as Proposal;
        }
        const { findListedProposalById } = await import("./github");
        const p = await findListedProposalById(ID);
        expect(p?.path).toBe(PATH);
        expect(p?.escrow_shared).not.toBe(true);
        expect(typeof p?.escrow_address).not.toBe("string");
        return p!;
      }

      it(`${source}, claim view pending: the page loads with no escrow row and no address read`, async () => {
        const app = await paint(await preloaded("pending"), "pending");
        expect(app.textContent).not.toContain("Could not load proposal");
        expect(app.querySelector(".proposal-title, h1")?.textContent).toContain("Non-string escrow bounty");
        expect(app.querySelector("#onchain-escrow-row")).toBeNull();
        expect(app.querySelector(".proposal-onchain")?.textContent).toContain("Submission fee");
        expect(addressHits).toEqual([]);
      });

      it(`${source}, claim view blocks Donate: loads, no escrow row`, async () => {
        const app = await paint(await preloaded("blocked"), "blocked");
        expect(app.textContent).not.toContain("Could not load proposal");
        expect(app.querySelector("#onchain-escrow-row")).toBeNull();
      });

      it(`${source}, claim view allows Donate: loads; the row shows only the claim view's address`, async () => {
        const app = await paint(await preloaded("allows"), "allows");
        expect(app.textContent).not.toContain("Could not load proposal");
        const rows = app.querySelectorAll<HTMLElement>("#onchain-escrow-row");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.querySelector("code")?.textContent).toBe(CLAIM_ADDR);
        expect(rows[0]!.querySelector<HTMLElement>(".copy-btn")?.dataset.escrowCopy).toBe(CLAIM_ADDR);
      });
    }
  });
}
