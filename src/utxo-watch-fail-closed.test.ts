/**
 * Review on fund#91: an unreadable address is not an empty one.
 * - F1: a 200 whose body isn't a UTXO list counts as a failed read (it used
 *   to become an EMPTY baseline, so the next good read recorded + claimed
 *   someone else's old UTXO and said "Credit linked").
 * - F2: fee-pay with the REAL watcher (fee-pay.test.ts mocks it).
 * - F3: Edit -> Continue during an outage keeps "detected automatically" hidden.
 * - F4: stop() while a read is in flight: that read announces nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,qq") },
}));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    lightningUiAllowed: () => false,
    MEMPOOL_API: "https://mempool.test/api",
    WORKERS_API: "https://api.test",
  };
});

import { bindDonatePanel, DONATE_WATCH_UNAVAILABLE_COPY, donateModalHtml } from "./proposal-ui";
import { watchNewUtxos } from "./funder-credit";
import { bindFeePay, feePayHtml } from "./fee-pay";
import { addressUtxos } from "./mempool";

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const PID = "PLEBLY-2026-009";
const PATH = "proposals/listed/PLEBLY-2026-009.md";
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const NEW = { txid: "ef".repeat(32), vout: 1, value: 7_000, status: { confirmed: true } };
const POLL = 50;
type Utxo = typeof OLD;
/** "nonarray": 200 with a JSON object body (explorer error page / proxy). */
type UtxoReply = Utxo[] | "down" | "nonarray" | "null" | "hang";

function stubFetch(first: UtxoReply) {
  let utxos: UtxoReply = first;
  const posts: { path: string; body: { txid?: string } }[] = [];
  let release: (() => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/utxo")) {
        if (utxos === "down") return new Response("down", { status: 503 });
        if (utxos === "nonarray") return Response.json({ error: "busy" });
        if (utxos === "null") return Response.json(null);
        if (utxos === "hang") {
          await new Promise<void>((r) => (release = r));
          return Response.json([OLD, NEW]);
        }
        return Response.json(utxos);
      }
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({ chain_stats: { funded_txo_sum: 25_000, spent_txo_sum: 0 } });
      }
      if (url.includes("/contributions/mine/")) return Response.json({ contributions: [] });
      if (init?.method === "POST" && url.startsWith("https://api.test/contributions/")) {
        posts.push({ path: url.slice("https://api.test".length), body: JSON.parse(String(init.body || "{}")) });
        return Response.json({ ok: true, entry: {} });
      }
      return Response.json({ ok: true });
    }),
  );
  return {
    posts,
    setUtxos: (n: UtxoReply) => {
      utxos = n;
    },
    release: () => release?.(),
  };
}

async function openPay(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = donateModalHtml(
    { id: PID, path: PATH, title: "U", status: "listed", escrow_address: ADDR } as never,
    { signedIn: true },
  );
  await bindDonatePanel(document, {
    address: ADDR,
    proposalId: PID,
    proposalPath: PATH,
    signedIn: true,
    initialBalance: null,
    balancePollMs: 60_000,
    utxoPollMs: POLL,
  });
  await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
  document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
}
const el = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const stopAll = () => {
  for (const n of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    n.__stopDonateWatchers?.();
  }
};
const stops: (() => void)[] = [];

afterEach(() => {
  for (const s of stops.splice(0)) s();
  stopAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
});

describe("addressUtxos: a 200 that isn't a list is a failed read (F1)", () => {
  for (const reply of ["nonarray", "null"] as const) {
    it(`${reply} body rejects instead of returning []`, async () => {
      stubFetch(reply);
      await expect(addressUtxos(ADDR)).rejects.toThrow(/not a list/);
    });
  }
  it("control: a real empty list is []; a list is returned as-is", async () => {
    const h = stubFetch([]);
    await expect(addressUtxos(ADDR)).resolves.toEqual([]);
    h.setUtxos([OLD]);
    await expect(addressUtxos(ADDR)).resolves.toEqual([OLD]);
  });
});

describe("watchNewUtxos: non-list first read = no baseline (F1)", () => {
  it("reports unavailable, then the first good read is a quiet baseline; only later UTXOs are new", async () => {
    const h = stubFetch("nonarray");
    const onNew = vi.fn();
    const states: string[] = [];
    const w = watchNewUtxos(ADDR, onNew, { intervalMs: 10, onBaselineState: (s) => states.push(s) });
    stops.push(w.stop);
    await w.ready;
    expect(states).toEqual(["unavailable"]);
    h.setUtxos([OLD]);
    await vi.waitFor(() => expect(states).toEqual(["unavailable", "ready"]));
    await new Promise((r) => setTimeout(r, 40));
    expect(onNew).not.toHaveBeenCalled();
    h.setUtxos([OLD, NEW]);
    await vi.waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(onNew.mock.calls[0]![0].map((u: Utxo) => u.txid)).toEqual([NEW.txid]);
  });
});

describe("Donate modal: 200 non-list first read never links an old UTXO (Review P1)", () => {
  it("non-list first read -> can't-check line; OLD then appears -> no record/claim, no 'Credit linked'; NEW later is linked", async () => {
    const h = stubFetch("nonarray");
    await openPay();
    await vi.waitFor(() => expect(el("#donate-watch-unavailable").hidden).toBe(false));
    expect(el("#donate-watch-unavailable").textContent).toBe(DONATE_WATCH_UNAVAILABLE_COPY);
    h.setUtxos([OLD]);
    await vi.advanceTimersByTimeAsync(POLL * 8);
    expect(h.posts.filter((p) => p.body.txid === OLD.txid)).toEqual([]);
    expect(el("#donate-confirm-status").textContent || "").not.toMatch(/credit linked/i);
    expect(el("#donate-watch-unavailable").hidden).toBe(true);
    h.setUtxos([OLD, NEW]);
    await vi.waitFor(() =>
      expect(h.posts.filter((p) => p.path === "/contributions/claim").map((p) => p.body.txid)).toEqual([NEW.txid]),
    );
    expect(h.posts.filter((p) => p.path === "/contributions/record").map((p) => p.body.txid)).toEqual([NEW.txid]);
  });
});

describe("Donate modal: Edit -> Continue during an outage (F3)", () => {
  it("keeps 'detected automatically' hidden while the can't-check line shows, and restores it on a good read", async () => {
    const h = stubFetch("down");
    await openPay();
    await vi.waitFor(() => expect(el("#donate-watch-unavailable").hidden).toBe(false));
    expect(el("#donate-watch-hint").hidden).toBe(true);
    el("#donate-credit-edit").click();
    el("#donate-credit-continue").click();
    expect(el("#donate-watch-unavailable").hidden).toBe(false);
    expect(el("#donate-watch-hint").hidden).toBe(true);
    h.setUtxos([OLD]);
    await vi.waitFor(() => expect(el("#donate-watch-unavailable").hidden).toBe(true));
    expect(el("#donate-watch-hint").hidden).toBe(false);
    expect(el("#donate-watch-hint").textContent).toMatch(/detected automatically/);
  });

  it("control: Edit -> Continue with a working watcher shows the hint", async () => {
    stubFetch([OLD]);
    await openPay();
    await vi.advanceTimersByTimeAsync(POLL * 2);
    el("#donate-credit-edit").click();
    el("#donate-credit-continue").click();
    expect(el("#donate-watch-unavailable").hidden).toBe(true);
    expect(el("#donate-watch-hint").hidden).toBe(false);
  });
});

describe("watchNewUtxos: stop() during an in-flight read (F4)", () => {
  it("the read that lands after stop() announces nothing", async () => {
    const h = stubFetch([OLD]);
    const onNew = vi.fn();
    const w = watchNewUtxos(ADDR, onNew, { intervalMs: 10 });
    stops.push(w.stop);
    await w.ready;
    h.setUtxos("hang");
    await new Promise((r) => setTimeout(r, 30)); // a tick is now waiting on the read
    w.stop();
    h.release();
    await new Promise((r) => setTimeout(r, 30));
    expect(onNew).not.toHaveBeenCalled();
  });
});

describe("fee-pay with the real watcher (F2)", () => {
  const OLD10 = { ...OLD, value: 10_000 };
  const NEW10 = { ...NEW, value: 10_000 };

  for (const first of ["down", "nonarray"] as const) {
    it(`failed first read (${first}) -> existing exact-amount UTXO is not filled; a later new one is`, async () => {
      const h = stubFetch(first);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      document.body.innerHTML = feePayHtml({ id: "pf", amountSats: 10_000, address: ADDR });
      const b = (await bindFeePay(document, "pf"))!;
      stops.push(b.stop);
      await vi.advanceTimersByTimeAsync(10);
      h.setUtxos([OLD10]);
      await vi.advanceTimersByTimeAsync(6_000 * 3);
      expect(b.getTxid()).toBe("");
      h.setUtxos([OLD10, NEW10]);
      await vi.advanceTimersByTimeAsync(6_000 * 2);
      expect(b.getTxid()).toBe(NEW10.txid);
    });
  }

  it("control: good first read -> existing exact-amount UTXO is not filled; a later new one is", async () => {
    const h = stubFetch([OLD10]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    document.body.innerHTML = feePayHtml({ id: "pf", amountSats: 10_000, address: ADDR });
    const b = (await bindFeePay(document, "pf"))!;
    stops.push(b.stop);
    await vi.advanceTimersByTimeAsync(6_000 * 2);
    expect(b.getTxid()).toBe("");
    h.setUtxos([OLD10, NEW10]);
    await vi.advanceTimersByTimeAsync(6_000 * 2);
    expect(b.getTxid()).toBe(NEW10.txid);
  });
});
