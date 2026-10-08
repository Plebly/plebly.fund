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

import {
  bindDonateModal,
  bindDonatePanel,
  closeDonateModalWhenBlocked,
  donateModalHtml,
  endowmentDonateModalHtml,
  endDonateProject,
} from "./proposal-ui";
import { closeAllGiftToasts, stopGiftLinks } from "./gift-link";
import {
  RECORD_RETRY_DELAYS_MS,
  RECORD_RETRY_STATUS_COPY,
  RECORD_RETRY_WINDOW_MS,
  RecordRetryCancelled,
  recordContributionWithRetry,
} from "./funder-credit";

/** UI UX copy, pinned literally. */
const RETRYING = "Linking your gift to your account\u2026 Keep this page open.";

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
  const posts: { path: string; at: number; body: string; auth: string | null }[] = [];
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
        posts.push({
          path,
          at: Date.now(),
          body: String(init.body ?? ""),
          auth: new Headers(init.headers).get("Authorization"),
        });
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

async function openAndDetect(
  h: ReturnType<typeof stubFetch>,
  o?: { modalOpen?: boolean },
): Promise<number> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = `<div id="app">${donateModalHtml(
    { id: PID, path: PATH, title: "U", status: "listed", escrow_address: ADDR } as never,
    { signedIn: true },
  )}</div>`;
  if (o?.modalOpen) {
    document.querySelector<HTMLElement>("#donate-modal")!.hidden = false;
    bindDonateModal(document);
  }
  await bindDonatePanel(document, {
    address: ADDR,
    proposalId: PID,
    proposalPath: PATH,
    proposalTitle: "U",
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
  stopGiftLinks();
  closeAllGiftToasts();
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

  it("onRetry fires once per wait, never on the final give-up", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    const onRetry = vi.fn();
    const done = recordContributionWithRetry(
      { proposal_id: PID, txid: NEW.txid, vout: 1, address: ADDR },
      { delaysMs: [10, 10], windowMs: 1_000, onRetry },
    ).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await done).toBeInstanceOf(Error);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("shouldContinue false during a wait stops the loop with RecordRetryCancelled", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return new Response("down", { status: 502 });
    }));
    let go = true;
    const done = recordContributionWithRetry(
      { proposal_id: PID, txid: NEW.txid, vout: 1, address: ADDR },
      { delaysMs: [1_000, 1_000, 1_000], windowMs: 10_000, shouldContinue: () => go },
    ).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    go = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toBeInstanceOf(RecordRetryCancelled);
    expect(calls).toBe(1);
  });

  it("a session change during an attempt stops before the wait: no retrying hook, no wait", async () => {
    vi.useFakeTimers();
    let go = true;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        go = false; // e.g. sign-out while this /record is in flight
        return new Response("down", { status: 502 });
      }),
    );
    const onRetry = vi.fn();
    let settled = false;
    const done = recordContributionWithRetry(
      { proposal_id: PID, txid: NEW.txid, vout: 1, address: ADDR },
      { delaysMs: [1_000, 1_000], windowMs: 10_000, onRetry, shouldContinue: () => go },
    )
      .catch((e: Error) => e)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(10);
    // Stopped at once: the "Keep this page open" hook never ran for the old session.
    expect(settled).toBe(true);
    expect(await done).toBeInstanceOf(RecordRetryCancelled);
    expect(onRetry).not.toHaveBeenCalled();
    expect(calls).toBe(1);
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
    expect(statusEl().textContent).toBe(RETRYING);

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
    expect(statusEl().textContent).not.toBe(RETRYING);
  });

  it("while retries run the status reads the retrying line exactly, then success replaces it", async () => {
    expect(RECORD_RETRY_STATUS_COPY).toBe(RETRYING);
    const h = stubFetch([busy, offline], ok);
    await openAndDetect(h);
    expect(h.records()).toHaveLength(1);
    expect(statusEl().textContent).toBe(RETRYING);
    expect(showsFailure()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_200); // second attempt fails too
    expect(h.records()).toHaveLength(2);
    expect(statusEl().textContent).toBe(RETRYING);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.records()).toHaveLength(3);
    expect(statusEl().textContent).toContain("Credit linked");
    expect(statusEl().textContent).not.toContain(RETRYING);
  });

  it("every retry sends the identical /record body, so the server sees a same-owner re-record", async () => {
    // workers: a re-record of an outpoint the same session already wrote is a
    // no-op (main contrib.ts:302-314; #86 contributions.ts:274-297, test :323).
    const h = stubFetch([() => new Response("bad gateway", { status: 502 }), offline, busy], ok);
    await openAndDetect(h);
    await vi.advanceTimersByTimeAsync(10_000);
    const bodies = h.records().map((r) => r.body);
    expect(bodies).toHaveLength(4);
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ proposal_id: PID, txid: NEW.txid, vout: NEW.vout, address: ADDR });
    expect(statusEl().textContent).toContain("Credit linked");
  });

  /** No further /record, no claim, no failure line, no retrying line left behind. */
  async function expectStopped(h: ReturnType<typeof stubFetch>, recordsBefore: number) {
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS + 10_000);
    expect(h.records()).toHaveLength(recordsBefore);
    expect(h.claims()).toHaveLength(0);
    expect(showsFailure()).toBe(false);
    expect(statusEl().textContent ?? "").not.toBe(RETRYING);
    expect(statusEl().textContent ?? "").not.toMatch(/credit linked/i);
  }

  const toastText = () => document.querySelector("#gift-toasts .gift-toast-text")?.textContent ?? null;

  it("modal closed mid-retry: retries continue and the later outcome gets the linked toast", async () => {
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h, { modalOpen: true });
    expect(h.records()).toHaveLength(1);
    expect(statusEl().textContent).toBe(RETRYING);
    expect(toastText()).toBeNull(); // modal open: inline only
    document.querySelector<HTMLButtonElement>("#donate-close")!.click();
    expect(document.querySelector<HTMLElement>("#donate-modal")!.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toHaveLength(3);
    expect(h.claims()).toHaveLength(1);
    expect(toastText()).toBe("Gift to U: Credit linked for 7,000 sats.");
  });

  it("modal closed during a retry wait: the Linking toast shows at once, then turns into the outcome in place", async () => {
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h, { modalOpen: true });
    expect(statusEl().textContent).toBe(RETRYING);
    expect(toastText()).toBeNull(); // modal open: inline only
    document.querySelector<HTMLButtonElement>("#donate-close")!.click();
    await vi.advanceTimersByTimeAsync(10); // well before the next attempt (+1 s)
    expect(h.records()).toHaveLength(1);
    expect(toastText()).toBe(`Gift to U: ${RETRYING}`);
    const el = document.querySelector<HTMLElement>("#gift-toasts .gift-toast")!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toHaveLength(3);
    expect(toastText()).toBe("Gift to U: Credit linked for 7,000 sats.");
    expect(document.querySelector("#gift-toasts .gift-toast")).toBe(el);
    expect(document.querySelectorAll("#gift-toasts .gift-toast")).toHaveLength(1);
  });

  it("modal closed while the first /record is still in flight: Linking toast at once, then the outcome in place", async () => {
    let release: () => void = () => undefined;
    const held: Reply = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(ok() as Response);
      }) as unknown as Response;
    const h = stubFetch([held], ok);
    await openAndDetect(h, { modalOpen: true });
    expect(h.records()).toHaveLength(1);
    expect(toastText()).toBeNull();
    document.querySelector<HTMLButtonElement>("#donate-close")!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(toastText()).toBe(`Gift to U: ${RETRYING}`);
    const el = document.querySelector<HTMLElement>("#gift-toasts .gift-toast")!;
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(toastText()).toBe("Gift to U: Credit linked for 7,000 sats.");
    expect(document.querySelector("#gift-toasts .gift-toast")).toBe(el);
  });

  it("modal closed by the claim view (blocked) mid-link: the Linking toast shows at once too", async () => {
    const h = stubFetch([busy], ok);
    await openAndDetect(h, { modalOpen: true });
    expect(toastText()).toBeNull();
    closeDonateModalWhenBlocked();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.records()).toHaveLength(1);
    expect(toastText()).toBe(`Gift to U: ${RETRYING}`);
  });

  /** In-app page change: the router's next page replaces #app's content (no close() call). */
  const changePage = () => {
    document.querySelector("#app")!.innerHTML = "<main><h1>Another page</h1></main>";
  };

  it("page change while the endowment modal (hosted in #app) is open mid-link: Linking toast at once, then the outcome in place", async () => {
    const h = stubFetch([busy, busy], ok);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // As endowment-page.ts renders it: the modal lives inside #app.
    document.body.innerHTML = `<div id="app"><main>Endowment</main>${endowmentDonateModalHtml(ADDR, { signedIn: true })}</div>`;
    document.querySelector<HTMLElement>("#donate-modal")!.hidden = false;
    bindDonateModal(document.querySelector<HTMLElement>("#app")!);
    await bindDonatePanel(document, {
      address: ADDR,
      proposalId: "endowment",
      proposalPath: "/endowment",
      proposalTitle: "Endowment",
      mode: "endowment",
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
    expect(h.records()).toHaveLength(1);
    expect(statusEl().textContent).toBe(RETRYING);
    expect(toastText()).toBeNull(); // modal open: inline only
    changePage();
    expect(document.querySelector("#donate-modal")).toBeNull(); // removed, never closed
    await vi.advanceTimersByTimeAsync(10); // well before the next attempt (+1 s)
    expect(h.records()).toHaveLength(1);
    expect(toastText()).toBe(`Gift to Endowment: ${RETRYING}`);
    const el = document.querySelector<HTMLElement>("#gift-toasts .gift-toast")!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toHaveLength(3);
    expect(toastText()).toBe("Gift to Endowment: Credit linked for 7,000 sats.");
    expect(document.querySelector("#gift-toasts .gift-toast")).toBe(el);
  });

  it("change to a non-project page while a body-hosted proposal modal is open mid-link: the modal gets the normal close, Linking toast at once, then the outcome in place (was: stayed open)", async () => {
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h, { modalOpen: true });
    // As mountDonateChromeWhenEscrowKnown hosts it: on document.body, outside #app.
    const modal = document.querySelector<HTMLElement>("#donate-modal")!;
    document.body.appendChild(modal);
    document.body.classList.add("modal-open");
    expect(statusEl().textContent).toBe(RETRYING);
    // What main.ts's render() runs for any page that isn't a project page.
    endDonateProject();
    changePage();
    // Synchronously, as the Close button does: no gap before the toast.
    expect(modal.isConnected).toBe(false);
    expect(document.body.classList.contains("modal-open")).toBe(false);
    expect(toastText()).toBe(`Gift to U: ${RETRYING}`);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toHaveLength(3);
    expect(toastText()).toContain("Credit linked for 7,000 sats");
    expect(document.querySelectorAll("#gift-toasts .gift-toast")).toHaveLength(1);
  });

  it("open modal, first-try link: inline line only, no toast", async () => {
    const h = stubFetch([ok], ok);
    await openAndDetect(h, { modalOpen: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.records()).toHaveLength(1);
    expect(statusEl().textContent).toContain("Credit linked for 7,000 sats");
    expect(document.querySelector("#gift-toasts .gift-toast")).toBeNull();
  });

  it("open modal, final refusal: inline failure only, no toast", async () => {
    const h = stubFetch([() => Response.json({ error: "x", code: "contribution_owned" }, { status: 409 })], ok);
    await openAndDetect(h, { modalOpen: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(showsFailure()).toBe(true);
    expect(document.querySelector("#gift-toasts .gift-toast")).toBeNull();
  });

  it("open modal through retries to the outcome: inline only, no toast at any point", async () => {
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h, { modalOpen: true });
    for (let t = 0; t < 10; t += 1) {
      expect(document.querySelector("#gift-toasts .gift-toast")).toBeNull();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(statusEl().textContent).toContain("Credit linked");
    expect(document.querySelector("#gift-toasts .gift-toast")).toBeNull();
  });

  it("in-app navigation (view torn down, #app replaced) does NOT stop the retries", async () => {
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(h.records()).toHaveLength(2);
    const panel = document.querySelector<HTMLElement & { __stopDonateWatchers?: () => void }>("#donate")!;
    panel.__stopDonateWatchers!();
    document.querySelector("#app")!.innerHTML = "<main><h1>Another page</h1></main>";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toHaveLength(3);
    expect(h.claims()).toHaveLength(1);
    expect(toastText()).toBe("Gift to U: Credit linked for 7,000 sats.");
  });

  it("page unload (stopGiftLinks / pagehide) mid-retry stops further /record calls", async () => {
    const h = stubFetch([], busy);
    await openAndDetect(h);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(h.records()).toHaveLength(2);
    window.dispatchEvent(new Event("pagehide"));
    await expectStopped(h, 2);
  });

  for (const [name, next] of [
    ["signing in as another account", "token-bob"],
    ["signing out", null],
  ] as const) {
    it(`a session change (${name}) mid-retry stops further /record calls`, async () => {
      sessionStorage.setItem("plebly_session", "token-alice");
      const h = stubFetch([], busy);
      await openAndDetect(h);
      expect(h.records()).toHaveLength(1);
      if (next) sessionStorage.setItem("plebly_session", next);
      else sessionStorage.removeItem("plebly_session");
      await expectStopped(h, 1);
      expect(h.records().map((r) => r.auth)).toEqual(["Bearer token-alice"]);
      // Modal closed: one neutral toast with the sign-in line, never the failure line.
      expect(toastText()).toBe(
        "Gift to U: Your sign-in changed, so this gift wasn't linked to an account. If you sent it, it will be held in escrow once it confirms.",
      );
      expect(document.querySelectorAll("#gift-toasts .gift-toast")).toHaveLength(1);
    });
  }

  it("an unchanged session keeps retrying (the session check isn't always false)", async () => {
    sessionStorage.setItem("plebly_session", "token-alice");
    const h = stubFetch([busy, busy], ok);
    await openAndDetect(h, { modalOpen: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records().map((r) => r.auth)).toEqual(Array(3).fill("Bearer token-alice"));
    expect(statusEl().textContent).toContain("Credit linked");
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
      expect(statusEl().textContent).not.toBe(RETRYING);
    });
  }
});

describe("sign-in change mid-link with the modal open: the inline line, no toast", () => {
  it("sign-out mid-retry, modal open: the inline line reads the sign-in line; no toast, no failure line", async () => {
    sessionStorage.setItem("plebly_session", "token-alice");
    const h = stubFetch([], busy);
    await openAndDetect(h, { modalOpen: true });
    expect(statusEl().textContent).toBe(RETRYING);
    sessionStorage.removeItem("plebly_session");
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS + 10_000);
    expect(h.records()).toHaveLength(1);
    expect(h.claims()).toHaveLength(0);
    expect(statusEl().textContent).toBe(
      "Your sign-in changed, so this gift wasn't linked to an account. If you sent it, it will be held in escrow once it confirms.",
    );
    expect(showsFailure()).toBe(false);
    expect(document.querySelector("#gift-toasts .gift-toast")).toBeNull();
  });
});
