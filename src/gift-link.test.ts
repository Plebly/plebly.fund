/**
 * App-level gift linking (gift-link.ts): one run and one toast per gift
 * (txid:vout), outside the Donate modal and the proposal view. Toast copy,
 * roles, auto-close vs persist, no focus steal, navigation survival, title
 * safety and capture, and two-gift isolation.
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
  closeAllGiftToasts,
  GIFT_LINK_FAILED_COPY,
  GIFT_LINKED_AUTO_CLOSE_MS,
  giftKey,
  linkGift,
  showGiftToast,
  stopGiftLinks,
} from "./gift-link";
import { RECORD_RETRY_DELAYS_MS, RECORD_RETRY_WINDOW_MS } from "./funder-credit";
import { bindDonatePanel, donateModalHtml } from "./proposal-ui";

/** UI UX / Tester copy, pinned literally. */
const RETRYING = "Linking your gift to your account\u2026 Keep this page open.";
/** #94's line, word for word. */
const FAILED =
  "A new deposit was seen at this address, but this page couldn't link it to your account. If you sent it, it will be held in escrow once it confirms.";

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const ADDR_Y = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const PID = "PLEBLY-2026-009";
const PID_Y = "PLEBLY-2026-010";
const PATH = "proposals/listed/PLEBLY-2026-009.md";
const PATH_Y = "proposals/listed/PLEBLY-2026-010.md";
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const A = { txid: "aa".repeat(32), vout: 1, value: 7_000, status: { confirmed: true } };
const B = { txid: "bb".repeat(32), vout: 2, value: 9_000, status: { confirmed: true } };
const POLL = 50;

type Reply = () => Response | Error;
const ok: Reply = () => Response.json({ ok: true, entry: {} });
const busy: Reply = () =>
  Response.json({ error: "contribution record in progress — retry", code: "contribution_busy" }, { status: 503 });
const owned: Reply = () => Response.json({ error: "x", code: "contribution_owned" }, { status: 409 });

/** Esplora + workers stub. /record replies are scripted per txid. */
function stubNet(script: Record<string, Reply[]>, fallback: Reply = ok) {
  const utxos: Record<string, (typeof OLD)[]> = { [ADDR]: [OLD], [ADDR_Y]: [] };
  const posts: { path: string; at: number; body: Record<string, unknown> }[] = [];
  const used: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const m = /\/address\/([^/?]+)\/utxo$/.exec(url);
      if (m) return Response.json(utxos[m[1]!] ?? []);
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({ chain_stats: { funded_txo_sum: 25_000, spent_txo_sum: 0 } });
      }
      if (url.includes("/contributions/mine/")) return Response.json({ contributions: [] });
      if (init?.method === "POST" && url.startsWith("https://api.test/contributions/")) {
        const path = url.slice("https://api.test".length);
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        posts.push({ path, at: Date.now(), body });
        if (path !== "/contributions/record") return ok();
        const txid = String(body.txid);
        const i = used[txid] ?? 0;
        used[txid] = i + 1;
        const r = (script[txid]?.[i] ?? fallback)();
        if (r instanceof Error) throw r;
        return r;
      }
      return Response.json({ ok: true });
    }),
  );
  return {
    records: (txid?: string) =>
      posts.filter((p) => p.path === "/contributions/record" && (!txid || p.body.txid === txid)),
    claims: (txid?: string) =>
      posts.filter((p) => p.path === "/contributions/claim" && (!txid || p.body.txid === txid)),
    arrive: (addr: string, u: typeof OLD) => {
      utxos[addr] = [...(utxos[addr] ?? []), u];
    },
  };
}

const region = () => document.querySelector<HTMLElement>("#gift-toasts");
const toastFor = (u: { txid: string; vout: number }) =>
  document.querySelector<HTMLElement>(`#gift-toasts [data-gift-key="${giftKey(u.txid, u.vout)}"]`);
const toastText = (u: { txid: string; vout: number }) =>
  toastFor(u)?.querySelector(".gift-toast-text")?.textContent ?? null;
const statusEl = () => document.querySelector<HTMLElement>("#donate-confirm-status")!;

function input(u: typeof A, title: string, extra?: { claim?: boolean }) {
  return {
    proposalTitle: title,
    record: { proposal_id: PID, txid: u.txid, vout: u.vout, address: ADDR },
    claim: extra?.claim === false ? null : { proposal_id: PID, txid: u.txid, vout: u.vout },
    valueSats: u.value,
  };
}

/** Render a proposal view into #app (as the router does) and arm its watcher. */
async function mountProposal(o: { id: string; path: string; title: string; address: string }) {
  let app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
  app.innerHTML = donateModalHtml(
    { id: o.id, path: o.path, title: o.title, status: "listed", escrow_address: o.address } as never,
    { signedIn: true },
  );
  await bindDonatePanel(document, {
    address: o.address,
    proposalId: o.id,
    proposalPath: o.path,
    proposalTitle: o.title,
    signedIn: true,
    initialBalance: null,
    balancePollMs: 600_000,
    utxoPollMs: POLL,
  });
  await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
  document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
  await vi.advanceTimersByTimeAsync(POLL * 2);
}

const X = { id: PID, path: PATH, title: "Signet faucet", address: ADDR };
const Y = { id: PID_Y, path: PATH_Y, title: "Relay fund", address: ADDR_Y };

afterEach(() => {
  stopGiftLinks();
  closeAllGiftToasts();
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
});

describe("toast copy and roles", () => {
  it("#94's failure line is pinned word for word", () => {
    expect(GIFT_LINK_FAILED_COPY).toBe(FAILED);
  });

  it("retrying → linked: exact lines, role=status, one toast for the gift updated in place", async () => {
    vi.useFakeTimers();
    const h = stubNet({ [A.txid]: [busy, busy] });
    const done = linkGift(input(A, "Signet faucet"));
    await vi.advanceTimersByTimeAsync(10);
    const el = toastFor(A)!;
    expect(el.querySelector(".gift-toast-text")!.textContent).toBe(`Gift to Signet faucet: ${RETRYING}`);
    expect(el.getAttribute("role")).toBe("status");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(toastText(A)).toBe(`Gift to Signet faucet: ${RETRYING}`); // stays through the retries
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await done).toBe(true);
    expect(h.records()).toHaveLength(3);
    expect(toastText(A)).toBe("Gift to Signet faucet: Credit linked for 7,000 sats.");
    expect(toastFor(A)!.getAttribute("role")).toBe("status");
    expect(region()!.querySelectorAll(".gift-toast")).toHaveLength(1);
    expect(toastFor(A)).toBe(el);
  });

  it("final refusal: #94's line, role=alert", async () => {
    vi.useFakeTimers();
    stubNet({ [A.txid]: [owned] });
    const err = await linkGift(input(A, "Signet faucet")).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(toastText(A)).toBe(`Gift to Signet faucet: ${FAILED}`);
    expect(toastFor(A)!.getAttribute("role")).toBe("alert");
  });

  it("exhausted retries: #94's line, role=alert", async () => {
    vi.useFakeTimers();
    stubNet({}, busy);
    const done = linkGift(input(A, "Signet faucet")).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS + 5_000);
    expect(await done).toBeInstanceOf(Error);
    expect(toastText(A)).toBe(`Gift to Signet faucet: ${FAILED}`);
    expect(toastFor(A)!.getAttribute("role")).toBe("alert");
  });
});

describe("close behaviour", () => {
  it("retrying has no Close button; it stays until the retries end", async () => {
    vi.useFakeTimers();
    stubNet({}, busy);
    void linkGift(input(A, "T")).catch(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(toastText(A)).toBe(`Gift to T: ${RETRYING}`);
    expect(toastFor(A)!.querySelector("button")).toBeNull();
  });

  it("linked auto-closes after about 10 s; its Close button closes it sooner", async () => {
    vi.useFakeTimers();
    stubNet({});
    await linkGift(input(A, "T"));
    expect(GIFT_LINKED_AUTO_CLOSE_MS).toBe(10_000);
    const close = toastFor(A)!.querySelector<HTMLButtonElement>("button.gift-toast-close")!;
    expect(close.textContent).toBe("Close");
    await vi.advanceTimersByTimeAsync(9_900);
    expect(toastFor(A)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(toastFor(A)).toBeNull();

    await linkGift(input(B, "T"));
    toastFor(B)!.querySelector<HTMLButtonElement>("button.gift-toast-close")!.click();
    expect(toastFor(B)).toBeNull();
  });

  it("failure never auto-closes; only its Close button removes it", async () => {
    vi.useFakeTimers();
    stubNet({ [A.txid]: [owned] });
    await linkGift(input(A, "T")).catch(() => {});
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(toastText(A)).toBe(`Gift to T: ${FAILED}`);
    const close = toastFor(A)!.querySelector<HTMLButtonElement>("button.gift-toast-close")!;
    expect(close.textContent).toBe("Close");
    close.click();
    expect(toastFor(A)).toBeNull();
  });
});

describe("focus", () => {
  it("no toast state takes focus: the focused field keeps it through retrying, linked and failed", async () => {
    vi.useFakeTimers();
    stubNet({ [A.txid]: [busy], [B.txid]: [owned] });
    document.body.insertAdjacentHTML("beforeend", `<input id="typing" />`);
    const field = document.querySelector<HTMLInputElement>("#typing")!;
    field.focus();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const a = linkGift(input(A, "T"));
    await vi.advanceTimersByTimeAsync(10);
    expect(document.activeElement).toBe(field); // retrying
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await a).toBe(true);
    expect(document.activeElement).toBe(field); // linked
    await linkGift(input(B, "T")).catch(() => {});
    expect(document.activeElement).toBe(field); // failed
    expect(focusSpy).not.toHaveBeenCalled();
    for (const el of region()!.querySelectorAll("*")) {
      expect(el.hasAttribute("autofocus")).toBe(false);
      expect(el.getAttribute("tabindex")).not.toBe("0");
    }
  });
});

describe("title safety and capture", () => {
  it("a hostile title renders as literal text: no <img>, no handler runs", async () => {
    vi.useFakeTimers();
    stubNet({ [A.txid]: [busy], [B.txid]: [owned] });
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const hostile = "<img src=x onerror=alert(1)>";
    const a = linkGift(input(A, hostile));
    await vi.advanceTimersByTimeAsync(10);
    expect(toastText(A)).toBe(`Gift to ${hostile}: ${RETRYING}`);
    expect(region()!.querySelector("img")).toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    await a;
    expect(toastText(A)).toBe(`Gift to ${hostile}: Credit linked for 7,000 sats.`);
    await linkGift(input(B, hostile)).catch(() => {});
    expect(toastText(B)).toBe(`Gift to ${hostile}: ${FAILED}`);
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(region()!.querySelector("img")).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("showGiftToast sets the title through textContent (direct call)", () => {
    showGiftToast("k:0", "<b>bold</b><img src=x onerror=alert(1)>", "failed");
    const el = document.querySelector('[data-gift-key="k:0"]')!;
    expect(el.querySelector("b, img")).toBeNull();
    expect(el.querySelector(".gift-toast-text")!.textContent).toBe(
      `Gift to <b>bold</b><img src=x onerror=alert(1)>: ${FAILED}`,
    );
  });

  it("the title is captured when the run starts; later changes to the caller's object don't leak in", async () => {
    vi.useFakeTimers();
    stubNet({ [A.txid]: [busy, busy] });
    const inp = input(A, "Signet faucet");
    const done = linkGift(inp);
    inp.proposalTitle = "Changed";
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(toastText(A)).toBe("Gift to Signet faucet: Credit linked for 7,000 sats.");
  });

  it("start A on proposal X, navigate to Y (which gets its own gift B): A's toast still says X", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = stubNet({ [A.txid]: [busy, busy, busy] });
    await mountProposal(X);
    h.arrive(ADDR, A);
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(toastText(A)).toBe(`Gift to Signet faucet: ${RETRYING}`);
    // In-app navigation: X's view torn down, Y rendered into #app.
    document.querySelector<HTMLElement & { __stopDonateWatchers?: () => void }>("#donate")!.__stopDonateWatchers!();
    await mountProposal(Y);
    h.arrive(ADDR_Y, B);
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(toastText(A)).toBe(`Gift to Signet faucet: ${RETRYING}`);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toastText(A)).toBe("Gift to Signet faucet: Credit linked for 7,000 sats.");
    expect(h.records(A.txid)).toHaveLength(4);
    expect(h.records(A.txid).every((r) => r.body.proposal_id === PID)).toBe(true);
    expect(h.records(B.txid).every((r) => r.body.proposal_id === PID_Y)).toBe(true);
  });
});

describe("runs", () => {
  it("one run per gift: a second call for the same txid:vout joins the first", async () => {
    vi.useFakeTimers();
    const h = stubNet({ [A.txid]: [busy] });
    const p1 = linkGift(input(A, "T"));
    const p2 = linkGift(input(A, "T"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(h.records(A.txid)).toHaveLength(2);
    expect(h.claims(A.txid)).toHaveLength(1);
  });

  it("stopGiftLinks ends runs without a toast or further calls", async () => {
    vi.useFakeTimers();
    const h = stubNet({}, busy);
    const done = linkGift(input(A, "T"));
    await vi.advanceTimersByTimeAsync(10);
    stopGiftLinks();
    expect(await (async () => { await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS); return done; })()).toBe(false);
    expect(h.records()).toHaveLength(1);
    expect(toastFor(A)).toBeNull();
  });

  it("a session change ends the run and removes its toast", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("plebly_session", "token-alice");
    const h = stubNet({}, busy);
    const done = linkGift(input(A, "T"));
    await vi.advanceTimersByTimeAsync(10);
    expect(toastText(A)).toBe(`Gift to T: ${RETRYING}`);
    sessionStorage.setItem("plebly_session", "token-bob");
    await vi.advanceTimersByTimeAsync(RECORD_RETRY_WINDOW_MS);
    expect(await done).toBe(false);
    expect(h.records()).toHaveLength(1);
    expect(h.claims()).toHaveLength(0);
    expect(toastFor(A)).toBeNull();
  });
});

describe("two gifts in one modal", () => {
  async function aThenB(aReplies: Reply[]) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = stubNet({ [A.txid]: aReplies });
    await mountProposal(X);
    h.arrive(ADDR, A);
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(h.records(A.txid)).toHaveLength(1); // A is now in its first backoff wait
    h.arrive(ADDR, B);
    await vi.advanceTimersByTimeAsync(POLL * 2);
    return h;
  }

  it("(a) A's late success doesn't overwrite B's modal line or B's toast; A's retries keep A's body", async () => {
    const h = await aThenB([busy, busy]);
    expect(statusEl().textContent).toContain("Credit linked for 9,000 sats");
    expect(toastText(B)).toBe("Gift to Signet faucet: Credit linked for 9,000 sats.");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records(A.txid)).toHaveLength(3);
    expect(toastText(A)).toBe("Gift to Signet faucet: Credit linked for 7,000 sats.");
    expect(statusEl().textContent).toContain("Credit linked for 9,000 sats");
    expect(statusEl().textContent).not.toContain("7,000");
    expect(toastText(B)).toBe("Gift to Signet faucet: Credit linked for 9,000 sats.");
    for (const r of h.records(A.txid)) expect(r.body).toMatchObject({ txid: A.txid, vout: A.vout });
    expect(new Set(h.records(A.txid).map((r) => JSON.stringify(r.body))).size).toBe(1);
    for (const r of h.records(B.txid)) expect(r.body).toMatchObject({ txid: B.txid, vout: B.vout });
  });

  it("(a) A's late failure doesn't put A's failure on B's modal line or B's toast", async () => {
    await aThenB([busy, owned]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(toastText(A)).toBe(`Gift to Signet faucet: ${FAILED}`);
    expect(statusEl().classList.contains("bad")).toBe(false);
    expect(statusEl().textContent).toContain("Credit linked for 9,000 sats");
    expect(toastText(B)).toBe("Gift to Signet faucet: Credit linked for 9,000 sats.");
  });

  it("(b) A's retries don't block or cancel B, and B doesn't cancel A; no client-side cap", async () => {
    const h = await aThenB([busy, busy, busy]);
    // B was sent during A's first wait (A's second attempt is at +1 s).
    expect(h.records(B.txid)).toHaveLength(1);
    expect(h.records(A.txid)).toHaveLength(1);
    expect(h.claims(B.txid)).toHaveLength(1);
    // A carries on to the same schedule as alone.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.records(A.txid)).toHaveLength(4);
    expect(h.claims(A.txid)).toHaveLength(1);
    expect(toastText(A)).toBe("Gift to Signet faucet: Credit linked for 7,000 sats.");
    // Both count toward the Worker's per-IP limit; the client schedule is unchanged.
    expect(RECORD_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
    expect(RECORD_RETRY_WINDOW_MS).toBe(60_000);
  });
});
