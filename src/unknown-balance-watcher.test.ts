/**
 * Unknown balance is not 0 (follow-up to plebly.fund#74).
 *
 * 1. Donate watcher: callers passed `initialBalance: balance ?? 0`, and the
 *    watcher fell back to 0 when its own first read failed. A unique row whose
 *    first read failed/timed out then announced "Confirmed · N added" with N =
 *    the whole existing balance on the next good read. Now the first good read
 *    is the baseline (shown, never announced); deltas start after it.
 * 2. Account › Watching pill: `formatSats(bal ?? 0)` said "0 sats" when the
 *    read failed. Now "Balance temporarily unavailable".
 * Known 0 behaves exactly as before in both.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";

const UNIQUE = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const UNAVAILABLE = "Balance temporarily unavailable";

/** Scripted mempool: each /address read takes the next entry ("fail" → 503); the last repeats. */
let reads: (number | "fail")[] = [];
let addressHits = 0;
function addressResponse(): Response {
  const next = reads.length > 1 ? reads.shift()! : reads[0]!;
  addressHits += 1;
  if (next === "fail") return new Response("down", { status: 503 });
  return Response.json({
    chain_stats: { funded_txo_sum: next, spent_txo_sum: 0 },
    mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
  });
}

function row(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "PLEBLY-2026-009",
    path: "proposals/listed/PLEBLY-2026-009.md",
    title: "Unique",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 100_000,
    escrow_address: UNIQUE,
    submission_fee_txid: "ab".repeat(32),
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: 9,
    milestones: [],
    body: "## Summary\n\nBody.",
    ...over,
  } as Proposal;
}

beforeEach(() => {
  reads = [];
  addressHits = 0;
  vi.resetModules();
});
/** Watchers started by a test; stopped even when an assertion fails (no polling leaks). */
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("watchConfirmedBalance with an unknown baseline", () => {
  function stubMempool() {
    vi.stubGlobal("fetch", vi.fn(async () => addressResponse()));
  }

  it("first read fails, then succeeds: baseline update only (previous null), never a delta from 0", async () => {
    reads = ["fail", 25_000, 25_000, 30_000];
    stubMempool();
    const { watchConfirmedBalance } = await import("./mempool");
    const onUpdate = vi.fn();
    const w = watchConfirmedBalance(UNIQUE, onUpdate, { intervalMs: 10 });
    stops.push(w.stop);
    await w.ready;
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(30_000, { previous: 25_000 }));
    w.stop();
    expect(onUpdate.mock.calls).toEqual([
      [25_000, { previous: null }],
      [30_000, { previous: 25_000 }],
    ]);
    expect(onUpdate).not.toHaveBeenCalledWith(25_000, { previous: 0 });
  });

  it("first read succeeds: baseline update (previous null), then real deltas", async () => {
    reads = [25_000, 25_000, 26_000];
    stubMempool();
    const { watchConfirmedBalance } = await import("./mempool");
    const onUpdate = vi.fn();
    const w = watchConfirmedBalance(UNIQUE, onUpdate, { intervalMs: 10 });
    stops.push(w.stop);
    await w.ready;
    expect(onUpdate.mock.calls).toEqual([[25_000, { previous: null }]]);
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(26_000, { previous: 25_000 }));
    w.stop();
  });

  it("control: known baseline 0 is a real balance; the first increase is a delta from 0", async () => {
    reads = [0, 25_000];
    stubMempool();
    const { watchConfirmedBalance } = await import("./mempool");
    const onUpdate = vi.fn();
    const w = watchConfirmedBalance(UNIQUE, onUpdate, { baseline: 0, intervalMs: 10 });
    stops.push(w.stop);
    await w.ready;
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(25_000, { previous: 0 }));
    w.stop();
    expect(onUpdate.mock.calls.every(([, m]) => m.previous !== null)).toBe(true);
  });
});

describe("Donate panel status line", () => {
  async function payStep(initialBalance: number | null, onBalanceUpdate = vi.fn()) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/address\/[^/?]+$/.test(url)) return addressResponse();
        if (url.includes("/contributions/mine/")) return Response.json({ contributions: [] });
        if (/\/address\/[^/?]+\/utxo/.test(url)) return Response.json([]);
        return Response.json({ ok: true });
      }),
    );
    const { bindDonatePanel, donateModalHtml } = await import("./proposal-ui");
    const p = row();
    document.body.innerHTML = donateModalHtml(p, { signedIn: true });
    await bindDonatePanel(document, {
      address: UNIQUE,
      proposalId: p.id,
      proposalPath: p.path,
      signedIn: true,
      initialBalance,
      onBalanceUpdate,
      balancePollMs: 50,
      utxoPollMs: 60_000,
    });
    await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
    document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
    return onBalanceUpdate;
  }
  const status = () => document.querySelector<HTMLElement>("#donate-confirm-status")!;

  it("unique row, unknown initial balance, first read fails then succeeds: no false 'N added'", async () => {
    reads = ["fail", 25_000];
    const onBalanceUpdate = await payStep(null);
    await vi.advanceTimersByTimeAsync(300);
    // The real balance reaches the page (meter / need line), with no announcement.
    expect(onBalanceUpdate).toHaveBeenCalledWith(25_000);
    expect(status().textContent || "").not.toMatch(/added/i);
    expect(status().textContent || "").not.toMatch(/25,000/);
    // A real donation afterwards is announced as its own amount.
    reads = [30_000];
    await vi.advanceTimersByTimeAsync(300);
    expect(status().textContent).toContain("Confirmed · 5,000 sats added");
    expect(status().textContent).not.toContain("30,000 sats added");
  });

  it("control: known initial balance 0 still announces the first donation as 'N added'", async () => {
    reads = [25_000];
    await payStep(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(status().textContent).toContain("Confirmed · 25,000 sats added");
  });
});

describe("page → Donate panel opts: unknown balance is passed as unknown, known 0 as 0", () => {
  const claim: Partial<ClaimStatus> = {
    proposal_id: "PLEBLY-2026-009",
    proposal_path: "proposals/listed/PLEBLY-2026-009.md",
    state: "below_floor",
    status: "listed",
    confirmed_balance_sats: 0,
    claim_floor_sats: CLAIM_FLOOR_SATS,
    escrow_address: UNIQUE,
    accepting_funds: true,
  };
  beforeAll(async () => {
    await import("./proposal-page");
  }, 30_000);

  async function initialBalanceAfterClaim(p: Proposal): Promise<number | null | undefined> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/address\/[^/?]+$/.test(url)) return addressResponse();
        if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
          return Response.json(claim);
        }
        return new Response("{}", { status: 404 });
      }),
    );
    document.body.innerHTML = `<div id="app"></div>`;
    const { renderProposalPage } = await import("./proposal-page");
    const ui = await import("./proposal-ui");
    void renderProposalPage(p.path, (i) => i, null, () => undefined, { ...p, endowment_funded: false });
    const app = document.querySelector<HTMLElement>("#app")!;
    await vi.waitFor(() => {
      if (!app.querySelector(".proposal-sidebar")) throw new Error("not painted");
    });
    const first = ui.getDonateChromeContext()?.panelOpts.initialBalance;
    // builder-panel rebuilds the opts once the claim view arrives.
    await vi.waitFor(
      () => {
        const s = app.querySelector("#next-card-sentence")?.textContent || "";
        if (!s || s === "…") throw new Error("claim not settled");
      },
      { timeout: 4_000 },
    );
    await new Promise((r) => setTimeout(r, 0));
    const after = ui.getDonateChromeContext()?.panelOpts.initialBalance;
    expect(after).toBe(first);
    return after;
  }

  it("unique row whose page read failed: initialBalance is not 0", async () => {
    reads = ["fail"];
    const b = await initialBalanceAfterClaim(row({ balance_sats: undefined }));
    expect(addressHits).toBeGreaterThan(0);
    expect(b == null).toBe(true);
  });

  it("control: known balance 0 is passed as 0", async () => {
    reads = [0];
    expect(await initialBalanceAfterClaim(row({ balance_sats: 0 }))).toBe(0);
  });
});

describe("Account › Watching pill", () => {
  async function pill(catalogBalance: number | null, mempool: number | "fail"): Promise<string> {
    reads = [mempool];
    document.body.innerHTML = `<div id="app"></div>`;
    sessionStorage.setItem("plebly_session", "test");
    const p = row();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (/\/address\/[^/?]+$/.test(url)) return addressResponse();
        if (url.includes("/proposals/catalog")) {
          return Response.json({
            scope: "listed",
            updated_at: "x",
            proposals: [{ ...p, balance_sats: catalogBalance }],
          });
        }
        if (/\/watch(\?|$)/.test(url)) {
          return Response.json({ watches: [{ proposal_id: p.id, proposal_path: p.path }] });
        }
        return new Response("{}", { status: 404 });
      }),
    );
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
    const el = document.querySelector("#watching-list .pill");
    expect(el).toBeTruthy();
    return el!.textContent || "";
  }

  it("unique row whose read failed: 'Balance temporarily unavailable', not '0 sats'", async () => {
    const text = await pill(null, "fail");
    expect(text).toBe(UNAVAILABLE);
    expect(text).not.toMatch(/\b0 sats\b/);
  });

  it("control: read returns 0 → '0 sats'", async () => {
    expect(await pill(null, 0)).toBe("0 sats");
  });

  it("control: catalog balance 0 → '0 sats' (no read needed)", async () => {
    expect(await pill(0, "fail")).toBe("0 sats");
  });
});
