/**
 * One shared-address rule (`isSharedEscrow`, fails toward shared) for the
 * balance path: a shared row never reads its address balance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { balanceAddressFor } from "./mempool";
import type { Proposal } from "./types";

const ADDR = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const UNIQUE = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
/** Live-like: DEMO and 001-008 on one address, every flag null. */
const NINE = ["PLEBLY-SIGNET-DEMO", ...Array.from({ length: 8 }, (_, i) => `PLEBLY-2026-00${i + 1}`)].map((id) => ({
  id,
  escrow_address: ADDR,
  escrow_shared: null as boolean | null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("balanceAddressFor uses isSharedEscrow", () => {
  it("live-like 9 rows on one address, flags null: every row takes the shared-balance path", () => {
    expect(NINE).toHaveLength(9);
    for (const row of NINE) expect(balanceAddressFor(row, NINE)).toBeNull();
  });

  it("direct link, no catalog, flag null: shared-balance path", () => {
    expect(balanceAddressFor({ escrow_address: ADDR, escrow_shared: null })).toBeNull();
    expect(balanceAddressFor({ escrow_address: ADDR })).toBeNull();
  });

  it("explicit false on its own address reads the address; a second row on it makes it shared", () => {
    const row = { escrow_address: UNIQUE, escrow_shared: false };
    expect(balanceAddressFor(row)).toBe(UNIQUE);
    expect(balanceAddressFor(row, [row])).toBe(UNIQUE);
    expect(balanceAddressFor(row, [row, { escrow_address: ` ${UNIQUE} `, escrow_shared: false }])).toBeNull();
    expect(balanceAddressFor({ escrow_address: UNIQUE, escrow_shared: true })).toBeNull();
  });
});

describe("home/stats enrichBalances pass the catalog", () => {
  it("live-like rows read no address; a unique row does", async () => {
    const hits: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const m = /\/address\/([^/?]+)$/.exec(String(input));
        if (m) hits.push(m[1]!);
        return Response.json({ chain_stats: { funded_txo_sum: 7, spent_txo_sum: 0 } });
      }),
    );
    const rows = [...NINE, { id: "PLEBLY-2026-009", escrow_address: UNIQUE, escrow_shared: false }].map(
      (r) => ({ ...r, path: `proposals/listed/${r.id}.md`, title: r.id, status: "listed" }) as unknown as Proposal,
    );
    for (const mod of ["./home-page", "./stats-page"] as const) {
      const { enrichBalances } = await import(mod);
      const out = await enrichBalances(rows);
      expect(out.slice(0, 9).every((p: Proposal) => p.balance_sats === undefined)).toBe(true);
      expect(out[9]!.balance_sats).toBe(7);
    }
    expect(hits).toEqual([UNIQUE, UNIQUE]);
  });

  it("a duplicated address with both flags false is shared once the catalog is passed", async () => {
    const hits: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const m = /\/address\/([^/?]+)$/.exec(String(input));
        if (m) hits.push(m[1]!);
        return Response.json({ chain_stats: { funded_txo_sum: 7, spent_txo_sum: 0 } });
      }),
    );
    const rows = ["A", "B"].map(
      (id) => ({ id, path: `p/${id}.md`, title: id, status: "listed", escrow_address: UNIQUE, escrow_shared: false }) as unknown as Proposal,
    );
    for (const mod of ["./home-page", "./stats-page"] as const) {
      const { enrichBalances } = await import(mod);
      await enrichBalances(rows);
    }
    expect(hits).toEqual([]);
  });
});

describe("an explicit escrow_shared: false survives the catalog mapping", () => {
  it("listListedProposals keeps false (and true); a missing flag stays missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/proposals/catalog")) {
          return Response.json({
            scope: "listed",
            updated_at: "x",
            proposals: [
              { id: "U", path: "proposals/listed/U.md", title: "U", status: "listed", escrow_address: UNIQUE, escrow_shared: false },
              { id: "S", path: "proposals/listed/S.md", title: "S", status: "listed", escrow_address: ADDR, escrow_shared: true },
              { id: "N", path: "proposals/listed/N.md", title: "N", status: "listed", escrow_address: ADDR },
            ],
          });
        }
        return new Response("{}", { status: 404 });
      }),
    );
    vi.resetModules();
    const { listListedProposals } = await import("./github");
    const byId = new Map((await listListedProposals()).map((p) => [p.id, p]));
    expect(byId.get("U")?.escrow_shared).toBe(false);
    expect(byId.get("S")?.escrow_shared).toBe(true);
    expect(byId.get("N")?.escrow_shared).toBeUndefined();
    expect(balanceAddressFor(byId.get("U")!)).toBe(UNIQUE);
  });

  it("applyCatalogRuntimeToProposal carries false onto the doc", async () => {
    const { applyCatalogRuntimeToProposal } = await import("./github");
    const doc = { id: "U", path: "p", title: "U", status: "listed", escrow_address: UNIQUE } as unknown as Proposal;
    const out = applyCatalogRuntimeToProposal(doc, { ...doc, escrow_shared: false } as Proposal);
    expect(out.escrow_shared).toBe(false);
  });
});
