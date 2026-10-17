import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test" };
});

import { bindDonationsLive } from "./donations-live";
import type { PublicDonation } from "./donations-page";

const don = (id: string, over: Partial<PublicDonation> = {}): PublicDonation => ({
  id,
  amount_sats: 21_000,
  target_type: "project",
  target_id: "PLEBLY-2026-003",
  target_label: "Knots spam heuristics",
  donated_at: new Date(Date.now() - 60_000).toISOString(),
  anonymous: false,
  donor_display: "alice",
  ...over,
});

let pages: Array<PublicDonation[] | Error>;
let fetchMock: ReturnType<typeof vi.fn>;
/** GET /endowment reply; null = network error. Default: the current live API (no shared flag). */
let endowmentReply: { body: unknown; status: number } | null;
const LEGACY_ENDOWMENT = {
  address: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
  configured: true,
  display_balance_sats: 148_106,
  goal_sats: 0,
};
const OWN_ENDOWMENT = {
  address: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
  configured: true,
  give_address_usable: true,
  balance_shared_with_escrow: false,
  balance_sats: 1,
  balance_unavailable: false,
  total_given_sats: 1,
  goal_sats: 0,
};
/** Ledger fetches only (the strip also reads /endowment once per mount). */
const ledgerCalls = () =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/donations"));

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const rows = () =>
  [...document.querySelectorAll<HTMLElement>(".donations-live-row")].map((li) => ({
    id: li.dataset.donationId,
    isNew: li.classList.contains("is-new"),
  }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  document.body.innerHTML = `<div id="root"><div id="donations-live-mount"></div></div>`;
  pages = [];
  endowmentReply = { body: LEGACY_ENDOWMENT, status: 200 };
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/endowment")) {
      if (!endowmentReply) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(endowmentReply.body), { status: endowmentReply.status });
    }
    const next = pages.length > 1 ? pages.shift()! : pages[0]!;
    if (next instanceof Error) return new Response("down", { status: 503 });
    return Response.json({ donations: next, total: next.length });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("bindDonationsLive", () => {
  it("does nothing without a #donations-live-mount", async () => {
    document.body.innerHTML = `<div id="root"></div>`;
    await bindDonationsLive(document);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a shared-escrow row is plain text, never a link (and never to /endowment)", async () => {
    pages = [[don("s", { target_type: "shared_escrow", target_id: "shared-escrow", target_label: "Shared escrow (001–008)" })]];
    await bindDonationsLive(document);
    const li = document.querySelector(".donations-live-row")!;
    const target = li.querySelector(".donations-live-target")!;
    expect(target.tagName).toBe("SPAN");
    expect(target.textContent).toBe("Shared escrow (001–008)");
    expect(li.querySelector("a")).toBeNull();
  });

  it("paints the latest 10 confirmed gifts, none marked new on first paint", async () => {
    pages = [[don("a"), don("b", { anonymous: true }), don("c", { target_type: "endowment", target_label: "Endowment" })]];
    await bindDonationsLive(document);
    expect(ledgerCalls()[0]).toBe("https://api.test/donations?limit=10&offset=0");
    expect(rows()).toEqual([
      { id: "a", isNew: false },
      { id: "b", isNew: false },
      { id: "c", isNew: false },
    ]);
    const li = document.querySelectorAll(".donations-live-row");
    expect(li[0]!.querySelector(".donations-live-donor")!.textContent).toBe("@alice");
    expect(li[0]!.querySelector(".donations-live-amount")!.textContent).toBe("21,000 sats");
    expect(li[0]!.querySelector("a")!.getAttribute("href")).toMatch(/\/p\/plebly-2026-003$/);
    expect(li[1]!.querySelector(".donations-live-donor")!.textContent).toBe("Anonymous");
    expect(li[2]!.querySelector("a")!.getAttribute("href")).toMatch(/\/endowment$/);
    expect(document.querySelector(".donations-live-when time")).toBeTruthy();
  });

  it("own address: heading names the endowment and the empty state links to it", async () => {
    endowmentReply = { body: OWN_ENDOWMENT, status: 200 };
    pages = [[]];
    await bindDonationsLive(document);
    expect(document.querySelector(".donations-live-head p:not(.donations-live-kicker)")!.textContent).toBe(
      "Live gifts into projects and the endowment.",
    );
    const empty = document.querySelector(".donations-live-empty")!;
    expect(empty.textContent).toContain("No confirmed gifts yet");
    const links = [...empty.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links.some((h) => /\/endowment$/.test(h!))).toBe(true);
    expect(links.some((h) => /#projects$/.test(h!))).toBe(true);
  });

  it.each([
    ["the current live API (no shared flag)", { body: LEGACY_ENDOWMENT, status: 200 }],
    ["balance_shared_with_escrow: true", { body: { ...OWN_ENDOWMENT, balance_shared_with_escrow: true, address: null, give_address_usable: false }, status: 200 }],
    ["give_address_usable: false", { body: { ...OWN_ENDOWMENT, give_address_usable: false }, status: 200 }],
    ["a 502", { body: { error: "down" }, status: 502 }],
    ["a network error", null],
  ])("%s: heading says projects only and the empty state has no endowment link", async (_l, reply) => {
    endowmentReply = reply;
    pages = [[]];
    await bindDonationsLive(document);
    expect(document.querySelector(".donations-live-head p:not(.donations-live-kicker)")!.textContent).toBe(
      "Live gifts into projects.",
    );
    const empty = document.querySelector(".donations-live-empty")!;
    expect(empty.textContent).toContain("No confirmed gifts yet");
    expect(empty.textContent).not.toContain("endowment");
    expect(empty.querySelector('a[href$="/endowment"]')).toBeNull();
    expect(empty.querySelector('a[href$="#projects"]')).not.toBeNull();
  });

  it("reads /endowment once per mount, not on every poll; the state holds across polls", async () => {
    endowmentReply = { body: OWN_ENDOWMENT, status: 200 };
    pages = [[]];
    await bindDonationsLive(document);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ledgerCalls()).toHaveLength(3);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/endowment"))).toHaveLength(1);
    expect(document.querySelector('.donations-live-empty a[href$="/endowment"]')).not.toBeNull();
  });

  it("first paint waits for a slow /endowment read (own heading on the first paint, no poll needed)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ledgerOnly = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/endowment")) {
        await gate;
        return new Response(JSON.stringify(OWN_ENDOWMENT), { status: 200 });
      }
      return ledgerOnly(url);
    });
    pages = [[]];
    const bound = bindDonationsLive(document);
    await flush();
    await flush();
    release();
    await bound;
    expect(ledgerCalls()).toHaveLength(1);
    expect(document.querySelector(".donations-live-head p:not(.donations-live-kicker)")!.textContent).toBe(
      "Live gifts into projects and the endowment.",
    );
  });

  it("a /endowment that never answers: the strip still paints after 4 s with the projects-only heading", async () => {
    let signal: AbortSignal | undefined;
    const ledgerOnly = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/endowment")) {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }
      return ledgerOnly(url);
    });
    pages = [[don("a")]];
    let done = false;
    const bound = bindDonationsLive(document).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3_999);
    expect(done).toBe(false);
    expect(rows()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await bound;
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    expect(document.querySelector(".donations-live-head p:not(.donations-live-kicker)")!.textContent).toBe(
      "Live gifts into projects.",
    );
    expect(signal?.aborted).toBe(true);
    // Polling carries on and does not re-read /endowment.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ledgerCalls()).toHaveLength(2);
  });

  it("an initial ledger failure still paints the own-address heading on the next poll", async () => {
    endowmentReply = { body: OWN_ENDOWMENT, status: 200 };
    pages = [new Error("down"), [don("a")]];
    await bindDonationsLive(document);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(document.querySelector(".donations-live-head p:not(.donations-live-kicker)")!.textContent).toBe(
      "Live gifts into projects and the endowment.",
    );
  });

  it("polls every 15 s and marks only unseen gifts as new, then clears the mark", async () => {
    pages = [[don("a")], [don("b"), don("a")]];
    await bindDonationsLive(document);
    expect(ledgerCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(ledgerCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(ledgerCalls()).toHaveLength(2);
    expect(rows()).toEqual([
      { id: "b", isNew: true },
      { id: "a", isNew: false },
    ]);
    await vi.advanceTimersByTimeAsync(900);
    expect(rows().every((r) => !r.isNew)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ledgerCalls()).toHaveLength(3);
  });

  it("an initial failure leaves the mount empty; a later failure keeps the last panel and keeps polling", async () => {
    pages = [new Error("down"), [don("a")], new Error("down"), [don("a")]];
    await bindDonationsLive(document);
    const mount = document.querySelector("#donations-live-mount")!;
    expect(mount.innerHTML).toBe("");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ledgerCalls()).toHaveLength(3);
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ledgerCalls()).toHaveLength(4);
  });

  it("stops polling once the mount leaves the document (SPA navigation)", async () => {
    pages = [[don("a")]];
    await bindDonationsLive(document);
    document.querySelector("#root")!.innerHTML = "<p>other page</p>";
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ledgerCalls()).toHaveLength(1);
  });

  it("a poll in flight when the mount leaves does not schedule another", async () => {
    pages = [[don("a")]];
    await bindDonationsLive(document);
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ledgerCalls()).toHaveLength(2);
    document.querySelector("#root")!.innerHTML = "<p>other page</p>";
    await flush();
    release(Response.json({ donations: [don("b")], total: 1 }));
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ledgerCalls()).toHaveLength(2);
  });

  it("escapes donor, target and id from the public ledger", async () => {
    pages = [[
      don('x"><img src=y>', {
        donor_display: "<script>bad()</script>",
        target_label: '<img src=x onerror="alert(1)">',
      }),
    ]];
    await bindDonationsLive(document);
    const panel = document.querySelector("#donations-live")!;
    expect(panel.querySelector("img, script")).toBeNull();
    expect(panel.querySelector(".donations-live-donor")!.textContent).toBe("@<script>bad()</script>");
    expect(panel.querySelector<HTMLElement>(".donations-live-row")!.dataset.donationId).toBe('x"><img src=y>');
  });
});
