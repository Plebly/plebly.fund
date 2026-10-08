/**
 * Donate modal: a transient /contributions/record failure (workers' 503
 * contribution_busy, other 5xx, network error) retries with backoff inside a
 * bounded window; 4xx (incl. 409) and an unaccepted 2xx stay final.
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

import { bindDonatePanel, donateModalHtml } from "./proposal-ui";
import {
  RECORD_RETRY_DELAYS_MS,
  RECORD_RETRY_WINDOW_MS,
  recordContributionWithRetry,
} from "./funder-credit";

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const PID = "PLEBLY-2026-009";
const PATH = "proposals/listed/PLEBLY-2026-009.md";
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const NEW = { txid: "ef".repeat(32), vout: 1, value: 7_000, status: { confirmed: true } };
const POLL = 50;
/** workers escrow indexer: `minute % 5 === 0` (src/index.ts:280). */
const INDEXER_PERIOD_MS = 5 * 60_000;

type Reply = () => Response | Error;
const ok: Reply = () => Response.json({ ok: true, entry: {} });
const busy: Reply = () =>
  Response.json({ error: "contribution record in progress — retry", code: "contribution_busy" }, { status: 503 });
const offline: Reply = () => new TypeError("Failed to fetch");

function stubFetch(recordReplies: Reply[], fallback: Reply) {
  let utxos = [OLD];
  const posts: { path: string; at: number }[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/utxo")) return Response.json(utxos);
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({ chain_stats: { funded_txo_sum: 25_000, spent_txo_sum: 0 } });
      }
      if (url.includes("/contributions/mine/")) return Response.json({ contributions: [] });
      if (init?.method === "POST" && url.startsWith("https://api.test/contributions/")) {
        const path = url.slice("https://api.test".length);
        posts.push({ path, at: Date.now() });
        const r = path === "/contributions/record" ? (recordReplies[i++] ?? fallback)() : ok();
        if (r instanceof Error) throw r;
        return r;
      }
      return Response.json({ ok: true });
    }),
  );
  return {
    posts,
    records: () => posts.filter((p) => p.path === "/contributions/record"),
    claims: () => posts.filter((p) => p.path === "/contributions/claim"),
    arrive: () => {
      utxos = [OLD, NEW];
    },
  };
}

const statusEl = () => document.querySelector<HTMLElement>("#donate-confirm-status")!;
const showsFailure = () => statusEl().classList.contains("bad");

async function openAndDetect(h: ReturnType<typeof stubFetch>): Promise<number> {
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
    balancePollMs: 600_000,
    utxoPollMs: POLL,
  });
  await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
  document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
  await vi.advanceTimersByTimeAsync(POLL * 2);
  h.arrive();
  await vi.advanceTimersByTimeAsync(POLL * 2);
  return h.records()[0]?.at ?? Date.now();
}

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

describe("retry window bound", () => {
  it("the whole retry window sits well inside one indexer period", () => {
    const sum = RECORD_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(RECORD_RETRY_WINDOW_MS);
    expect(RECORD_RETRY_WINDOW_MS).toBeLessThanOrEqual(60_000);
    expect(RECORD_RETRY_WINDOW_MS * 4).toBeLessThanOrEqual(INDEXER_PERIOD_MS);
  });

  it("no attempt starts after the window, even with long delays", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push(Date.now());
        return new Response("down", { status: 502 });
      }),
    );
    const t0 = Date.now();
    const p = recordContributionWithRetry(
      { proposal_id: PID, txid: NEW.txid, vout: 1, address: ADDR },
      { delaysMs: Array(10).fill(10_000), windowMs: 25_000 },
    );
    const done = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(await done).toBeInstanceOf(Error);
    expect(calls.map((t) => t - t0)).toEqual([0, 10_000, 20_000]);
  });
});

describe("Donate modal: transient /record failures retry with backoff", () => {
  it("busy (503 contribution_busy) twice, then success: no failure line, credit linked", async () => {
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h);
    for (let t = 0; t < 10; t += 1) {
      expect(showsFailure()).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toHaveLength(3);
    expect(h.claims()).toHaveLength(1);
    expect(showsFailure()).toBe(false);
    expect(statusEl().textContent).toContain("Credit linked for 7,000 sats");
  });

  it("network error, then other 5xx, then success: no failure line", async () => {
    const h = stubFetch([offline, () => new Response("bad gateway", { status: 502 })], ok);
    await openAndDetect(h);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.records()).toHaveLength(3);
    expect(showsFailure()).toBe(false);
    expect(statusEl().textContent).toContain("Credit linked");
  });

  it("exhausted retries show the failure line only after the window, and within the bound", async () => {
    const h = stubFetch([], busy);
    const first = await openAndDetect(h);
    // Still trying (not failed) through most of the backoff.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(showsFailure()).toBe(false);
    expect(statusEl().textContent).toMatch(/linking/i);

    let shownAt: number | null = null;
    for (let t = 0; t < 400 && shownAt == null; t += 1) {
      await vi.advanceTimersByTimeAsync(250);
      if (showsFailure()) shownAt = Date.now();
    }
    expect(shownAt).not.toBeNull();
    expect(shownAt! - first).toBeLessThan(RECORD_RETRY_WINDOW_MS);
    expect(h.records()).toHaveLength(RECORD_RETRY_DELAYS_MS.length + 1);
    const lastStart = h.records().at(-1)!.at - first;
    expect(lastStart).toBeLessThanOrEqual(RECORD_RETRY_WINDOW_MS);
    expect(h.claims()).toHaveLength(0);
    expect(statusEl().textContent).not.toMatch(/credit linked/i);
  });

  const finals: [string, Reply][] = [
    ["409 contribution_owned", () => Response.json({ error: "x", code: "contribution_owned" }, { status: 409 })],
    ["409 contribution_anonymous_indexed", () => Response.json({ error: "x", code: "contribution_anonymous_indexed" }, { status: 409 })],
    ["400", () => Response.json({ error: "vout does not pay proposal escrow address" }, { status: 400 })],
    ["429", () => Response.json({ error: "rate limit exceeded — try again later" }, { status: 429 })],
    ["2xx ok:false", () => Response.json({ ok: false, error: "not accepted" })],
  ];
  for (const [name, reply] of finals) {
    it(`${name}: no retry, failure shows at once`, async () => {
      const h = stubFetch([reply], ok);
      await openAndDetect(h);
      expect(showsFailure()).toBe(true);
      await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS + 5_000);
      expect(h.records()).toHaveLength(1);
      expect(h.claims()).toHaveLength(0);
      expect(statusEl().textContent).not.toMatch(/credit linked/i);
    });
  }
});
