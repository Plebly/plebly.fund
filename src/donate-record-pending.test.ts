/**
 * workers#91: /contributions/record answers 202 (code pending_index) when it
 * wrote no row yet; the indexer adds the gift at 2 confirmations. Every 202,
 * signed in or out, shows one neutral line: no "Credit linked", no Retry or
 * Link button, no retry loop, no toast. Main never returns 202.
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
import { closeAllGiftToasts, stopGiftLinks } from "./gift-link";
import {
  RECORD_PENDING_INDEX_COPY,
  RECORD_RETRY_WINDOW_MS,
  recordContributionWithRetry,
} from "./funder-credit";

/** UI UX copy, pinned literally. */
const PENDING = "Thanks. Your gift will show on this proposal after 2 confirmations.";

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const PID = "PLEBLY-2026-009";
const PATH = "proposals/listed/PLEBLY-2026-009.md";
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const NEW = { txid: "ef".repeat(32), vout: 1, value: 7_000, status: { confirmed: false } };
const POLL = 50;

type Reply = () => Response;
const pending: Reply = () =>
  Response.json(
    {
      ok: true,
      recorded: false,
      code: "pending_index",
      message: "Seen. It will be indexed once the transaction has 2 confirmations.",
    },
    { status: 202 },
  );
const busy: Reply = () => Response.json({ error: "busy", code: "contribution_busy" }, { status: 503 });

function stubFetch(recordReplies: Reply[], fallback: Reply) {
  let utxos = [OLD];
  const posts: { path: string }[] = [];
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
        posts.push({ path });
        if (path === "/contributions/record") return (recordReplies[i++] ?? fallback)();
        return Response.json({ ok: true });
      }
      return Response.json({ ok: true });
    }),
  );
  return {
    records: () => posts.filter((p) => p.path === "/contributions/record"),
    claims: () => posts.filter((p) => p.path === "/contributions/claim"),
    arrive: () => {
      utxos = [OLD, NEW];
    },
  };
}

const statusEl = () => document.querySelector<HTMLElement>("#donate-confirm-status")!;

async function openAndDetect(h: ReturnType<typeof stubFetch>, signedIn: boolean) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = `<div id="app">${donateModalHtml(
    { id: PID, path: PATH, title: "U", status: "listed", escrow_address: ADDR } as never,
    { signedIn },
  )}</div>`;
  await bindDonatePanel(document, {
    address: ADDR,
    proposalId: PID,
    proposalPath: PATH,
    proposalTitle: "U",
    signedIn,
    initialBalance: null,
    balancePollMs: 600_000,
    utxoPollMs: POLL,
  });
  await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
  document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
  await vi.advanceTimersByTimeAsync(POLL * 2);
  h.arrive();
  await vi.advanceTimersByTimeAsync(POLL * 2);
}

/** The neutral line, exactly: no success/failure/live styling, nothing else around it. */
function expectPendingLine(h: ReturnType<typeof stubFetch>) {
  expect(statusEl().hidden).toBe(false);
  expect(statusEl().textContent).toBe(PENDING);
  for (const cls of ["ok", "bad", "live"]) expect(statusEl().classList.contains(cls)).toBe(false);
  expect(document.body.textContent).not.toMatch(/credit linked/i);
  expect(document.querySelector("[data-claim-txid]")).toBeNull(); // no Link this / Retry
  expect(document.querySelector("#gift-toasts .gift-toast")).toBeNull();
  expect(h.claims()).toHaveLength(0);
}

afterEach(() => {
  stopGiftLinks();
  closeAllGiftToasts();
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("/record 202 pending_index", () => {
  it("the line is pinned word for word", () => {
    expect(RECORD_PENDING_INDEX_COPY).toBe(PENDING);
  });

  it("signed in: 202 shows exactly the neutral line, never the credit line, no toast, no claim", async () => {
    const h = stubFetch([pending], pending);
    await openAndDetect(h, true);
    expectPendingLine(h);
  });

  it("signed in: 202 is never retried (one /record, through the whole window)", async () => {
    const h = stubFetch([pending], busy);
    await openAndDetect(h, true);
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS + 10_000);
    expect(h.records()).toHaveLength(1);
    expectPendingLine(h);
  });

  it("a 202 after a 503 retry ends the loop: the retrying toast goes, the neutral line shows", async () => {
    const h = stubFetch([busy, pending], busy);
    await openAndDetect(h, true);
    expect(document.querySelector("#gift-toasts .gift-toast")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS + 10_000);
    expect(h.records()).toHaveLength(2);
    expectPendingLine(h);
  });

  it("signed out: 202 gets the same neutral line", async () => {
    const h = stubFetch([pending], pending);
    await openAndDetect(h, false);
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS);
    expect(h.records()).toHaveLength(1);
    expectPendingLine(h);
  });

  it("the client call reports 202 as pending, with a single request", async () => {
    const f = vi.fn(async () => pending());
    vi.stubGlobal("fetch", f);
    const input = { proposal_id: PID, txid: NEW.txid, vout: 1, address: ADDR };
    expect(await recordContributionWithRetry(input, { delaysMs: [10, 10], windowMs: 1_000 })).toBe(
      "pending_index",
    );
    expect(f).toHaveBeenCalledTimes(1);
  });
});
