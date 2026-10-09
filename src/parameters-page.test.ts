import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

import {
  KEYHOLDER_CAP_SATS,
  KEYHOLDER_FEE_PERCENT,
  PLATFORM_FEE_PERCENT,
} from "./generated/parameters";
import { renderParameters } from "./parameters-page";

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const values = () =>
  [...app().querySelectorAll(".about-param")].map((el) => ({
    dt: el.querySelector("dt")!.textContent!.trim(),
    value: el.querySelector(".about-param-value")!.textContent!.trim(),
    hint: el.querySelector(".about-param-hint")!.textContent!.trim(),
  }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("renderParameters", () => {
  it("paints a loading state inside the shell before the fetch resolves", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const done = renderParameters(shell);
    expect(app().querySelector("[data-shell] .loading")?.textContent).toBe("Loading parameters…");
    resolve(new Response("x", { status: 500 }));
    await done;
    expect(app().querySelector(".loading")).toBeNull();
  });

  it("shows the live fees, total and cap from GET <api>/parameters", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        platform_fee_percent: 3,
        keyholder_fee_percent: 1.5,
        total_fee_percent: 99,
        keyholder_cap_sats: 250_000,
        keyholders: [],
      }),
    );
    await renderParameters(shell);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/parameters");
    const v = values();
    expect(v.map((x) => [x.dt, x.value])).toEqual([
      ["Platform fee", "3%"],
      ["Keyholder fee", "1.5%"],
      // Total is platform + keyholder, not the payload's total_fee_percent.
      ["Total take", "4.5%"],
    ]);
    expect(v[1]!.hint).toContain("Cap 250,000 sats per keyholder.");
  });

  it.each([
    ["a non-OK response", () => Promise.resolve(new Response("down", { status: 503 }))],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("falls back to the published parameters on %s", async (_label, impl) => {
    fetchMock.mockImplementation(impl);
    await renderParameters(shell);
    const v = values();
    expect(v[0]!.value).toBe(`${PLATFORM_FEE_PERCENT}%`);
    expect(v[1]!.value).toBe(`${KEYHOLDER_FEE_PERCENT}%`);
    expect(v[2]!.value).toBe(`${PLATFORM_FEE_PERCENT + KEYHOLDER_FEE_PERCENT}%`);
    expect(v[1]!.hint).toContain(`Cap ${KEYHOLDER_CAP_SATS.toLocaleString("en-US")} sats`);
    expect(app().textContent).toContain("No active keyholders published yet.");
  });

  it("uses published values field-by-field when the live payload omits one", async () => {
    fetchMock.mockResolvedValue(Response.json({ platform_fee_percent: 1, keyholders: [] }));
    await renderParameters(shell);
    const v = values();
    expect(v[0]!.value).toBe("1%");
    expect(v[1]!.value).toBe(`${KEYHOLDER_FEE_PERCENT}%`);
    expect(v[2]!.value).toBe(`${1 + KEYHOLDER_FEE_PERCENT}%`);
  });

  it("lists the keyholder roster, with — for missing keys and 0 for no signings", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        platform_fee_percent: 2.5,
        keyholder_fee_percent: 2,
        keyholder_cap_sats: 500_000,
        keyholders: [
          { github: "alice", xpub: "tpubAAA", fingerprint: "deadbeef", signing_count: 3 },
          { github: "bob", xpub: null, fingerprint: null },
        ],
      }),
    );
    await renderParameters(shell);
    const rows = [...app().querySelectorAll(".about-keyholders-table tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ["alice", "deadbeef", "tpubAAA", "3"],
      ["bob", "—", "—", "0"],
    ]);
    expect(app().textContent).not.toContain("No active keyholders published yet.");
  });

  it("escapes roster fields from the API (no markup injection)", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        keyholders: [
          { github: '<img src=x onerror="alert(1)">', xpub: "<b>x</b>", fingerprint: "<i>f</i>" },
        ],
      }),
    );
    await renderParameters(shell);
    const table = app().querySelector(".about-keyholders-table")!;
    expect(table.querySelector("img, b, i")).toBeNull();
    expect(table.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
