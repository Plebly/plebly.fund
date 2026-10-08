import { afterEach, describe, expect, it, vi } from "vitest";

const cfg = { WORKERS_API: "https://api.test/" };
vi.mock("./config", () => ({
  get WORKERS_API() {
    return cfg.WORKERS_API;
  },
}));

import { fetchProposalViews, fetchProposalViewsBatch, recordProposalView } from "./views";

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cfg.WORKERS_API = "https://api.test/";
});

describe("fetchProposalViews / recordProposalView", () => {
  it("GETs and POSTs /views/<encoded id> and returns view_count", async () => {
    const fn = stubFetch(async () => new Response(JSON.stringify({ view_count: 7 })));
    expect(await fetchProposalViews("PLEBLY 2026/001")).toBe(7);
    expect(await recordProposalView("PLEBLY 2026/001")).toBe(7);
    expect(fn.mock.calls.map(([u, i]) => [u, i?.method])).toEqual([
      ["https://api.test/views/PLEBLY%202026%2F001", "GET"],
      ["https://api.test/views/PLEBLY%202026%2F001", "POST"],
    ]);
  });

  it("returns null without a request for an empty id or no API", async () => {
    const fn = stubFetch(async () => new Response("{}"));
    expect(await fetchProposalViews("")).toBeNull();
    cfg.WORKERS_API = "";
    expect(await recordProposalView("x")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null on non-OK, non-numeric count, bad JSON or network error", async () => {
    stubFetch(async () => new Response(JSON.stringify({ view_count: 7 }), { status: 500 }));
    expect(await fetchProposalViews("x")).toBeNull();
    stubFetch(async () => new Response(JSON.stringify({ view_count: "7" })));
    expect(await fetchProposalViews("x")).toBeNull();
    stubFetch(async () => new Response("<html>"));
    expect(await fetchProposalViews("x")).toBeNull();
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await recordProposalView("x")).toBeNull();
  });
});

describe("fetchProposalViewsBatch", () => {
  it("dedupes, trims and encodes ids into one request; keeps numeric counts only", async () => {
    const fn = stubFetch(async () =>
      new Response(JSON.stringify({ counts: { a: 1, "b/c": 2, d: "3", e: null } })),
    );
    const out = await fetchProposalViewsBatch([" a ", "a", "b/c", "", "  ", "d"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe("https://api.test/views?ids=a,b%2Fc,d");
    expect([...out]).toEqual([
      ["a", 1],
      ["b/c", 2],
    ]);
  });

  it("returns an empty map without a request for no ids or no API", async () => {
    const fn = stubFetch(async () => new Response("{}"));
    expect((await fetchProposalViewsBatch(["", " "])).size).toBe(0);
    cfg.WORKERS_API = "";
    expect((await fetchProposalViewsBatch(["a"])).size).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns an empty map on non-OK, missing counts or network error", async () => {
    stubFetch(async () => new Response(JSON.stringify({ counts: { a: 1 } }), { status: 503 }));
    expect((await fetchProposalViewsBatch(["a"])).size).toBe(0);
    stubFetch(async () => new Response("{}"));
    expect((await fetchProposalViewsBatch(["a"])).size).toBe(0);
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect((await fetchProposalViewsBatch(["a"])).size).toBe(0);
  });
});
