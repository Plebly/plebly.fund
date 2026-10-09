import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

import { downloadReceiptPdf, fetchMyReceipts } from "./receipts";

const receipt = {
  id: "0123456789abcdef",
  donor_name: "Anon",
  amount_sats: 50_000,
  amount_btc: "0.0005",
  amount_usd: 30,
  btc_price_usd: 60_000,
  price_source: "mempool",
  price_at: "2026-10-01T00:00:00Z",
  donated_at: "2026-10-01T00:00:00Z",
  proposal_id: "PLEBLY-2026-001",
  proposal_title: "T",
  proposal_path: "proposals/x.md",
  created_at: "2026-10-01T00:00:00Z",
};

let fetchMock: ReturnType<typeof vi.fn>;
let clicked: { href: string; download: string }[];
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
  createObjectURL = vi.fn(() => "blob:receipt");
  revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("fetchMyReceipts", () => {
  it("GETs /receipts with the session bearer", async () => {
    sessionStorage.setItem("plebly_session", "tok");
    fetchMock.mockResolvedValue(Response.json({ receipts: [receipt] }));
    await expect(fetchMyReceipts()).resolves.toEqual([receipt]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/receipts");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(init.credentials).toBe("include");
  });

  it("is empty for a non-array receipts field", async () => {
    fetchMock.mockResolvedValue(Response.json({ receipts: { r: receipt } }));
    await expect(fetchMyReceipts()).resolves.toEqual([]);
  });

  it("is empty (not a throw) on a non-OK response", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 401 }));
    await expect(fetchMyReceipts()).resolves.toEqual([]);
  });
});

describe("downloadReceiptPdf", () => {
  const pdf = (headers: Record<string, string> = {}) =>
    new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
      status: 200,
      headers,
    });

  it("downloads with the server's Content-Disposition filename", async () => {
    fetchMock.mockResolvedValue(
      pdf({ "Content-Disposition": 'attachment; filename="BDI-receipt-2026-001.pdf"' }),
    );
    await downloadReceiptPdf("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/receipts/a%2Fb/pdf");
    expect(clicked).toEqual([{ href: "blob:receipt", download: "BDI-receipt-2026-001.pdf" }]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt");
  });

  it("falls back to BDI-receipt-<first 8 of id>.pdf", async () => {
    fetchMock.mockResolvedValue(pdf());
    await downloadReceiptPdf(receipt.id);
    expect(clicked[0].download).toBe("BDI-receipt-01234567.pdf");
  });

  it("throws a readable error and starts no download on failure", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(downloadReceiptPdf("x")).rejects.toThrow("Could not download receipt.");
    expect(clicked).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
