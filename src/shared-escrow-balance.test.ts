/**
 * Pairs with Plebly/workers#50. Rows the catalog marks `escrow_shared: true`
 * sit on one test escrow (tb1qhj27…: 001–008 + PLEBLY-SIGNET-DEMO). Their
 * address balance is every row's coins (10,586 on each row in the live
 * catalog, 2026-10-07 11:47 PM ET), so the site must never fall back to the
 * mempool address balance for them. balance_sats from the catalog is the
 * proposal's own confirmed structured outputs (006 = 36,030, 007 = 16,576) or
 * null.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAIM_FLOOR_SATS } from "./config";
import { balanceAddressFor } from "./mempool";
import type { Proposal } from "./types";

const SHARED = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const UNIQUE = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const ADDRESS_BALANCE = 10_586;
const FEE_TXID = "ab".repeat(32);

function row(over: Partial<Proposal>): Proposal {
  return {
    id: "PLEBLY-2026-007",
    path: "proposals/listed/PLEBLY-2026-007.md",
    title: "Shared",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 10_000,
    escrow_address: SHARED,
    submission_fee_txid: FEE_TXID,
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "## Summary\n\nBody.",
    ...over,
  } as Proposal;
}

/** Catalog rows as workers#50 serves them. */
const CATALOG = [
  { id: "PLEBLY-2026-006", status: "in_review", escrow_address: SHARED, escrow_shared: true, balance_sats: 36_030 },
  { id: "PLEBLY-2026-007", status: "claimable", escrow_address: SHARED, escrow_shared: true, balance_sats: 16_576 },
  { id: "PLEBLY-2026-008", status: "voided", escrow_address: SHARED, escrow_shared: true, balance_sats: null },
  { id: "PLEBLY-SIGNET-DEMO", status: "listed", escrow_address: SHARED, escrow_shared: true, balance_sats: null },
  { id: "PLEBLY-2026-009", status: "listed", escrow_address: UNIQUE, balance_sats: 10_000 },
].map((p) => ({ ...p, path: `proposals/listed/${p.id}.md`, title: p.id, proposal_type: "bounty", target_sats: 10_000 }));

let addressHits: string[] = [];
/** fetch: mempool /address/<a> → ADDRESS_BALANCE; catalog → CATALOG; else `other`. */
function stubFetch(other: (url: string) => Promise<Response> = async () => Response.json({})) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const m = url.match(/\/address\/([^/?]+)$/);
      if (m) {
        addressHits.push(decodeURIComponent(m[1]!));
        return Response.json({
          chain_stats: { funded_txo_sum: ADDRESS_BALANCE, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.includes("/proposals/catalog")) {
        return Response.json({ scope: "listed", updated_at: "x", proposals: CATALOG });
      }
      return other(url);
    }),
  );
}

beforeEach(() => {
  addressHits = [];
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("balanceAddressFor (the one helper)", () => {
  it("never returns a shared escrow address", () => {
    expect(balanceAddressFor({ escrow_address: SHARED, escrow_shared: true })).toBeNull();
    // No flag counts as shared (isSharedEscrow fails toward shared); only explicit false is unique.
    expect(balanceAddressFor({ escrow_address: UNIQUE })).toBeNull();
    expect(balanceAddressFor({ escrow_address: ` ${UNIQUE} `, escrow_shared: false })).toBe(UNIQUE);
    expect(balanceAddressFor({ escrow_address: null })).toBeNull();
    expect(balanceAddressFor(undefined)).toBeNull();
  });
});

describe("catalog mapping carries escrow_shared", () => {
  it("listListedProposals keeps escrow_shared and the per-proposal balance", async () => {
    stubFetch();
    const { listListedProposals } = await import("./github");
    const byId = new Map((await listListedProposals()).map((p) => [p.id, p]));
    expect(byId.get("PLEBLY-2026-006")).toMatchObject({ escrow_shared: true, balance_sats: 36_030 });
    expect(byId.get("PLEBLY-SIGNET-DEMO")?.escrow_shared).toBe(true);
    expect(byId.get("PLEBLY-SIGNET-DEMO")?.balance_sats).toBeUndefined();
    expect(byId.get("PLEBLY-2026-009")?.escrow_shared).toBeUndefined();
  });

  it("doc + catalog overlay: shared flag wins and the doc balance is not a fallback", async () => {
    const { applyCatalogRuntimeToProposal } = await import("./github");
    const doc = row({ status: "listed", balance_sats: ADDRESS_BALANCE });
    const shared = applyCatalogRuntimeToProposal(doc, row({ status: "listed", escrow_shared: true, balance_sats: undefined }));
    expect(shared.escrow_shared).toBe(true);
    expect(shared.balance_sats).toBeUndefined();
    const unique = applyCatalogRuntimeToProposal(doc, row({ status: "listed", balance_sats: undefined }));
    expect(unique.balance_sats).toBe(ADDRESS_BALANCE);
  });
});

describe("home-page enrichBalances", () => {
  it("shared row without a balance is not filled from the address", async () => {
    stubFetch();
    const { enrichBalances } = await import("./home-page");
    const [shared, unique] = await enrichBalances([
      row({ escrow_shared: true }),
      row({ id: "u", escrow_address: UNIQUE, escrow_shared: false }),
    ]);
    expect(shared!.balance_sats).toBeUndefined();
    expect(unique!.balance_sats).toBe(ADDRESS_BALANCE);
    expect(addressHits).toEqual([UNIQUE]);
  });
});

describe("stats-page enrichBalances", () => {
  it("shared row without a balance is not filled from the address", async () => {
    stubFetch();
    const { enrichBalances } = await import("./stats-page");
    const [shared, unique] = await enrichBalances([
      row({ escrow_shared: true }),
      row({ id: "u", escrow_address: UNIQUE, escrow_shared: false }),
    ]);
    expect(shared!.balance_sats).toBeUndefined();
    expect(unique!.balance_sats).toBe(ADDRESS_BALANCE);
    expect(addressHits).toEqual([UNIQUE]);
  });
});

describe("home total counts each shared coin once", () => {
  it("catalog → enrichBalances → totals use per-proposal amounts only", async () => {
    stubFetch();
    const { listListedProposals } = await import("./github");
    const { enrichBalances } = await import("./home-page");
    const { claimFloorShortfall } = await import("./builder");
    const { computePublicStats } = await import("./stats-page");
    const rows = await enrichBalances(await listListedProposals());
    expect(addressHits).toEqual([]);
    // 006 + 007 outputs + 009; before: DEMO/008 also read 10,586 from the address.
    expect(computePublicStats(rows).escrowed).toBe(36_030 + 16_576 + 10_000);
    const { fundedTowardFloor } = claimFloorShortfall(rows, CLAIM_FLOOR_SATS);
    const toward = (b: number) => (b < CLAIM_FLOOR_SATS ? b : 0);
    expect(fundedTowardFloor).toBe(toward(16_576) + toward(10_000));
  });
});

describe("proposal page initial balance", () => {
  async function paint(p: Proposal): Promise<HTMLElement> {
    document.body.innerHTML = `<div id="app"></div>`;
    stubFetch(() => new Promise<Response>(() => undefined));
    const { renderProposalPage } = await import("./proposal-page");
    void renderProposalPage(p.path, (inner) => inner, null, () => undefined, {
      ...p,
      endowment_funded: false,
    });
    const app = document.querySelector<HTMLElement>("#app")!;
    await vi.waitFor(() => {
      if (!app.querySelector(".proposal-onchain")) throw new Error("not painted yet");
    });
    return app;
  }

  it("shared row: no mempool address read before paint", async () => {
    await paint(row({ escrow_shared: true, balance_sats: undefined }));
    expect(addressHits).not.toContain(SHARED);
  });

  it("unique row without a balance: still reads its address (unchanged)", async () => {
    await paint(row({ escrow_address: UNIQUE, escrow_shared: false, balance_sats: undefined }));
    expect(addressHits).toContain(UNIQUE);
  });
});

describe("account watching list", () => {
  async function renderWatching(watch: { id: string; path: string }) {
    document.body.innerHTML = `<div id="app"></div>`;
    sessionStorage.setItem("plebly_session", "test");
    stubFetch(async (url) => {
      if (/\/watch(\?|$)/.test(url)) {
        return Response.json({ watches: [{ proposal_id: watch.id, proposal_path: watch.path }] });
      }
      return new Response("{}", { status: 404 });
    });
    const { renderAccount } = await import("./profile-pages");
    await renderAccount(
      {
        user: { id: "github:alice", username: "alice" } as never,
        routeName: "account",
        shell: (inner) => inner,
        rerender: () => undefined,
      },
      "watching",
    );
  }

  it("shared watched row (balance null): not filled from the address", async () => {
    await renderWatching({ id: "PLEBLY-SIGNET-DEMO", path: "proposals/listed/PLEBLY-SIGNET-DEMO.md" });
    expect(document.querySelector("#watching-list")).toBeTruthy();
    expect(addressHits).not.toContain(SHARED);
  });
});

describe("donate panel balance watcher", () => {
  async function payStep(escrowShared: boolean, address: string) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(async (url) =>
      url.includes("/contributions/mine/")
        ? Response.json({ contributions: [] })
        : Response.json({ ok: true }),
    );
    const { bindDonatePanel, donateModalHtml } = await import("./proposal-ui");
    const p = row({ escrow_address: address, escrow_shared: escrowShared });
    document.body.innerHTML = donateModalHtml(p, { signedIn: true });
    await bindDonatePanel(document, {
      address,
      proposalId: p.id,
      proposalPath: p.path,
      signedIn: true,
      escrowShared,
      balancePollMs: 50,
      utxoPollMs: 50,
    });
    await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
    document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
    await vi.advanceTimersByTimeAsync(200);
  }

  it("shared escrow: never polls the address balance", async () => {
    await payStep(true, SHARED);
    expect(addressHits).not.toContain(SHARED);
  });

  it("unique escrow: still polls (unchanged)", async () => {
    await payStep(false, UNIQUE);
    expect(addressHits).toContain(UNIQUE);
  });
});

describe("router JSON-LD", () => {
  it("drops raised (amount) when balance_sats is null; keeps it for a number", async () => {
    const { proposalJsonLd } = await import("./router");
    const base = { id: "PLEBLY-SIGNET-DEMO", title: "t", description: "d", path: "proposals/listed/x.md", status: "listed", target_sats: 100_000 };
    const campaign = (b: number | null) =>
      (proposalJsonLd({ ...base, balance_sats: b })["@graph"] as Record<string, unknown>[])[0]!;
    expect(campaign(null)).not.toHaveProperty("amount");
    expect(campaign(36_030).amount).toMatchObject({ value: "0.00036030" });
  });
});

describe("home card: escrow_shared row without confirmed own funding", () => {
  const shared = (over: Partial<Proposal>) =>
    row({ escrow_shared: true, balance_sats: undefined, structured_state: "awaiting_funds", accepting_funds: true, ...over } as Partial<Proposal>);
  async function card(p: Proposal) {
    const { proposalCardHtml } = await import("./home-page");
    const el = document.createElement("div");
    el.innerHTML = proposalCardHtml(p, CLAIM_FLOOR_SATS, false, false);
    return el;
  }

  it("fundable: 'Awaiting confirmation', no sats line and no bar", async () => {
    const el = await card(shared({ status: "listed" }));
    expect(el.textContent).toContain("Awaiting confirmation");
    expect(el.querySelector(".project-card-meter .sats")).toBeNull();
    expect(el.textContent).not.toMatch(/0 sats|to open/);
  });

  it("terminal (voided, settled, declined, completed, catalog-blocked): no balance at all", async () => {
    const terminal: Partial<Proposal>[] = [
      { status: "voided" },
      { status: "completed" },
      { status: "declined" },
      { status: "in_review", structured_state: "voided", accepting_funds: false },
      { status: "claimable", bounty_settled: true } as Partial<Proposal>,
      { status: "listed", accepting_funds: false },
    ];
    for (const over of terminal) {
      const el = await card(shared(over));
      expect(el.querySelector(".project-card-meter")).toBeNull();
      expect(el.textContent).not.toContain("Awaiting confirmation");
      expect(el.textContent).not.toMatch(/\b0 sats\b/);
    }
  });

  it("shared row with its own confirmed amount still shows the normal meter", async () => {
    const el = await card(shared({ status: "claimable", balance_sats: 16_576 }));
    expect(el.querySelector(".project-card-meter .sats")).toBeTruthy();
    expect(el.textContent).not.toContain("Awaiting confirmation");
  });

  it("neither case adds to the home shortfall/total", async () => {
    const { claimFloorShortfall } = await import("./builder");
    const base = claimFloorShortfall([row({ id: "u", escrow_address: UNIQUE, balance_sats: 1_000 })], CLAIM_FLOOR_SATS);
    const withShared = claimFloorShortfall(
      [
        row({ id: "u", escrow_address: UNIQUE, balance_sats: 1_000 }),
        shared({ id: "demo", status: "listed" }),
        shared({ id: "v", status: "voided" }),
      ],
      CLAIM_FLOOR_SATS,
    );
    expect(withShared).toEqual(base);
  });
});

describe("proposal detail page: escrow_shared row without confirmed own funding", () => {
  async function paintDetail(p: Proposal, addressFails = false): Promise<HTMLElement> {
    document.body.innerHTML = `<div id="app"></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/address\/[^/?]+$/.test(url)) {
          addressHits.push(url);
          return Promise.resolve(
            addressFails
              ? new Response("down", { status: 503 })
              : Response.json({ chain_stats: { funded_txo_sum: ADDRESS_BALANCE, spent_txo_sum: 0 } }),
          );
        }
        return new Promise<Response>(() => undefined);
      }),
    );
    const { renderProposalPage } = await import("./proposal-page");
    void renderProposalPage(p.path, (inner) => inner, null, () => undefined, {
      ...p,
      endowment_funded: false,
    });
    const app = document.querySelector<HTMLElement>("#app")!;
    await vi.waitFor(() => {
      if (!app.querySelector(".proposal-onchain")) throw new Error("not painted yet");
    });
    return app;
  }
  const sharedNull = (over: Partial<Proposal>) =>
    row({
      escrow_shared: true,
      balance_sats: undefined,
      structured_state: "awaiting_funds",
      accepting_funds: true,
      ...over,
    } as Partial<Proposal>);

  it("fundable: 'Awaiting confirmation', no '0 sats', no sats line or bar", async () => {
    const app = await paintDetail(sharedNull({ status: "listed" }));
    const bar = app.querySelector(".proposal-funding-bar")!;
    expect(bar.textContent).toContain("Awaiting confirmation");
    expect(bar.querySelector(".sats, .funding-detail-track, .funding-track")).toBeNull();
    expect(app.textContent).not.toMatch(/\b0 sats\b/);
  });

  it("terminal (voided / settled / catalog-blocked): no funding meter at all", async () => {
    const terminal: Partial<Proposal>[] = [
      { status: "voided" },
      { status: "in_review", structured_state: "voided", accepting_funds: false },
      { status: "claimable", bounty_settled: true } as Partial<Proposal>,
      { status: "listed", accepting_funds: false },
    ];
    for (const over of terminal) {
      const app = await paintDetail(sharedNull(over));
      expect(app.querySelector(".proposal-funding-bar")).toBeNull();
      expect(app.querySelector(".funding-meter")).toBeNull();
      expect(app.textContent).not.toContain("Awaiting confirmation");
    }
  });

  it("confirmed own funding: normal meter with the per-proposal amount, not the pending state", async () => {
    const app = await paintDetail(sharedNull({ status: "listed", balance_sats: 16_576 }));
    const bar = app.querySelector(".proposal-funding-bar")!;
    expect(bar.getAttribute("data-shared-pending")).toBeNull();
    expect(bar.textContent).toContain("16,576");
    expect(bar.textContent).not.toContain("Awaiting confirmation");
    expect(bar.textContent).not.toContain("10,586");
  });

  it("non-shared row with a null balance is unchanged (normal meter)", async () => {
    const app = await paintDetail(
      row({ escrow_address: UNIQUE, balance_sats: undefined, status: "listed" }),
      true,
    );
    const bar = app.querySelector(".proposal-funding-bar")!;
    expect(bar).toBeTruthy();
    expect(bar.querySelector(".funding-meter-goal.sats")).toBeTruthy();
    expect(bar.textContent).not.toContain("Awaiting confirmation");
  });
});
