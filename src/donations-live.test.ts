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
  fetchMock = vi.fn(async () => {
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

  it("paints the latest 10 confirmed gifts, none marked new on first paint", async () => {
    pages = [[don("a"), don("b", { anonymous: true }), don("c", { target_type: "endowment", target_label: "Endowment" })]];
    await bindDonationsLive(document);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.test/donations?limit=10&offset=0");
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

  it("shows the empty state with endowment and projects links when there are no gifts", async () => {
    pages = [[]];
    await bindDonationsLive(document);
    const empty = document.querySelector(".donations-live-empty")!;
    expect(empty.textContent).toContain("No confirmed gifts yet");
    const links = [...empty.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links.some((h) => /\/endowment$/.test(h!))).toBe(true);
    expect(links.some((h) => /#projects$/.test(h!))).toBe(true);
  });

  it("polls every 15 s and marks only unseen gifts as new, then clears the mark", async () => {
    pages = [[don("a")], [don("b"), don("a")]];
    await bindDonationsLive(document);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual([
      { id: "b", isNew: true },
      { id: "a", isNew: false },
    ]);
    await vi.advanceTimersByTimeAsync(900);
    expect(rows().every((r) => !r.isNew)).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("an initial failure leaves the mount empty; a later failure keeps the last panel and keeps polling", async () => {
    pages = [new Error("down"), [don("a")], new Error("down"), [don("a")]];
    await bindDonationsLive(document);
    const mount = document.querySelector("#donations-live-mount")!;
    expect(mount.innerHTML).toBe("");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops polling once the mount leaves the document (SPA navigation)", async () => {
    pages = [[don("a")]];
    await bindDonationsLive(document);
    document.querySelector("#root")!.innerHTML = "<p>other page</p>";
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a poll in flight when the mount leaves does not schedule another", async () => {
    pages = [[don("a")]];
    await bindDonationsLive(document);
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    document.querySelector("#root")!.innerHTML = "<p>other page</p>";
    await flush();
    release(Response.json({ donations: [don("b")], total: 1 }));
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
