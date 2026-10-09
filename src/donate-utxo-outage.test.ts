/**
 * Donate modal: a failed first UTXO read must not turn existing UTXOs (someone
 * else's earlier payment) into "this donor's payment", and "Credit linked"
 * shows only after the server accepts the claim.
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

import {
  bindDonatePanel,
  DONATE_WATCH_UNAVAILABLE_COPY,
  donateModalHtml,
} from "./proposal-ui";

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const PID = "PLEBLY-2026-009";
const PATH = "proposals/listed/PLEBLY-2026-009.md";
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const NEW = { txid: "ef".repeat(32), vout: 1, value: 7_000, status: { confirmed: true } };
const POLL = 50;

type Utxo = typeof OLD;
type Reply = Response | Error;

interface Harness {
  posts: { path: string; body: { txid?: string; vout?: number } }[];
  setUtxos: (next: Utxo[] | "down") => void;
  setClaim: (reply: () => Reply) => void;
}

function stubFetch(firstUtxos: Utxo[] | "down"): Harness {
  let utxos: Utxo[] | "down" = firstUtxos;
  let claim: () => Reply = () => Response.json({ ok: true, entry: {} });
  const posts: Harness["posts"] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/utxo")) {
        return utxos === "down"
          ? new Response("down", { status: 503 })
          : Response.json(utxos);
      }
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({ chain_stats: { funded_txo_sum: 25_000, spent_txo_sum: 0 } });
      }
      if (url.includes("/contributions/mine/")) return Response.json({ contributions: [] });
      if (init?.method === "POST" && url.startsWith("https://api.test/contributions/")) {
        const path = url.slice("https://api.test".length);
        posts.push({ path, body: JSON.parse(String(init.body || "{}")) });
        if (path === "/contributions/claim") {
          const r = claim();
          if (r instanceof Error) throw r;
          return r;
        }
        return Response.json({ ok: true, entry: {} });
      }
      return Response.json({ ok: true });
    }),
  );
  return {
    posts,
    setUtxos: (next) => {
      utxos = next;
    },
    setClaim: (reply) => {
      claim = reply;
    },
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

const statusText = () => document.querySelector("#donate-confirm-status")?.textContent || "";
const unavailableLine = () => document.querySelector<HTMLElement>("#donate-watch-unavailable")!;
const watchHint = () => document.querySelector<HTMLElement>("#donate-watch-hint")!;
const postsFor = (h: Harness, txid: string) => h.posts.filter((p) => p.body.txid === txid);

afterEach(() => {
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
});

describe("Donate modal: failed first UTXO read", () => {
  it("does not record, claim, or link an existing UTXO after the read recovers", async () => {
    const h = stubFetch("down");
    await openPay();
    await vi.advanceTimersByTimeAsync(10);
    h.setUtxos([OLD]);
    await vi.advanceTimersByTimeAsync(POLL * 8);

    expect(h.posts.filter((p) => p.path === "/contributions/record")).toEqual([]);
    expect(h.posts.filter((p) => p.path === "/contributions/claim")).toEqual([]);
    expect(postsFor(h, OLD.txid)).toEqual([]);
    expect(statusText()).not.toMatch(/credit linked/i);
    expect(statusText()).not.toMatch(/payment seen/i);
  });

  it("records and claims a UTXO first seen after the recovered read, exactly once", async () => {
    const h = stubFetch("down");
    await openPay();
    await vi.advanceTimersByTimeAsync(10);
    h.setUtxos([OLD]);
    await vi.advanceTimersByTimeAsync(POLL * 4);
    expect(h.posts).toEqual([]);

    h.setUtxos([OLD, NEW]);
    await vi.advanceTimersByTimeAsync(POLL * 8);

    const record = h.posts.filter((p) => p.path === "/contributions/record");
    const claim = h.posts.filter((p) => p.path === "/contributions/claim");
    expect(record.map((p) => `${p.body.txid}:${p.body.vout}`)).toEqual([`${NEW.txid}:1`]);
    expect(claim.map((p) => `${p.body.txid}:${p.body.vout}`)).toEqual([`${NEW.txid}:1`]);
    expect(postsFor(h, OLD.txid)).toEqual([]);
    expect(statusText()).toContain("Credit linked for 7,000 sats");
  });

  it("shows the can't-check line while the first read is failing and hides it on a good read", async () => {
    const h = stubFetch("down");
    await openPay();
    await vi.waitFor(() => expect(unavailableLine().hidden).toBe(false));
    expect(unavailableLine().textContent).toBe(
      "Can't check deposits right now. If you've already sent, the escrow balance will update once it confirms, but this page can't link it to your account.",
    );
    expect(unavailableLine().textContent).toBe(DONATE_WATCH_UNAVAILABLE_COPY);
    // No credit promise while we can't see deposits.
    expect(DONATE_WATCH_UNAVAILABLE_COPY).not.toMatch(/credit linked|will be credited|you'll get credit/i);
    expect(watchHint().hidden).toBe(true);

    h.setUtxos([OLD]);
    await vi.waitFor(() => expect(unavailableLine().hidden).toBe(true));
    expect(watchHint().hidden).toBe(false);
  });

  it("keeps the line hidden and stays quiet about existing UTXOs when the first read works", async () => {
    const h = stubFetch([OLD]);
    await openPay();
    await vi.advanceTimersByTimeAsync(POLL * 4);
    expect(unavailableLine().hidden).toBe(true);
    expect(watchHint().hidden).toBe(false);
    expect(h.posts).toEqual([]);
    expect(statusText()).not.toMatch(/credit linked/i);
  });
});

describe("Donate modal: Credit linked only after the server accepts the claim", () => {
  async function seeNewUtxo(h: Harness): Promise<void> {
    await openPay();
    await vi.advanceTimersByTimeAsync(POLL * 2);
    h.setUtxos([OLD, NEW]);
    // claimContributionWithRetry: up to 6 attempts, 2.5 s apart.
    await vi.advanceTimersByTimeAsync(20_000);
  }

  const cases: [string, () => Reply][] = [
    ["rejected (400)", () => Response.json({ error: "contribution already claimed by another user" }, { status: 400 })],
    ["server error (503)", () => new Response("upstream", { status: 503 })],
    ["network error", () => new TypeError("Failed to fetch")],
    ["2xx without ok:true", () => Response.json({ ok: false, error: "not accepted" })],
    ["2xx with an empty body", () => Response.json({})],
  ];

  for (const [name, reply] of cases) {
    it(`claim ${name} -> no "Credit linked"`, async () => {
      const h = stubFetch([OLD]);
      h.setClaim(reply);
      await seeNewUtxo(h);
      expect(h.posts.some((p) => p.path === "/contributions/claim")).toBe(true);
      expect(statusText()).not.toMatch(/credit linked/i);
    });
  }

  it('claim accepted (2xx, ok:true) -> "Credit linked"', async () => {
    const h = stubFetch([OLD]);
    await seeNewUtxo(h);
    expect(statusText()).toContain("Credit linked for 7,000 sats");
  });
});
