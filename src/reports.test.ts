import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

import {
  fetchOpenReports,
  fileModerationReport,
  resolveModerationReport,
} from "./reports";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const html = (status: number) =>
  new Response("<!DOCTYPE html><p>Bad gateway</p>", { status });

const report = {
  id: "r1",
  target_type: "comment" as const,
  proposal_id: "PLEBLY-2026-001",
  comment_id: "c1",
  reason: "spam",
  escalate_requested: false,
  status: "open",
  created_at: "2026-10-01T00:00:00Z",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("fileModerationReport", () => {
  const input = {
    target_type: "comment" as const,
    proposal_id: "PLEBLY-2026-001",
    comment_id: "c1",
    reason: "spam",
  };

  it("POSTs the report with the session bearer and returns the receipt", async () => {
    sessionStorage.setItem("plebly_session", "tok");
    fetchMock.mockResolvedValue(
      json(201, { report_id: "r1", queue: "keyholders", decision_id: "d1", comment_hidden: true }),
    );
    await expect(fileModerationReport(input)).resolves.toEqual({
      report_id: "r1",
      queue: "keyholders",
      decision_id: "d1",
      comment_hidden: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/reports");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it("defaults the queue to moderation", async () => {
    fetchMock.mockResolvedValue(json(201, { report_id: "r1" }));
    const out = await fileModerationReport(input);
    expect(out.queue).toBe("moderation");
    expect(out.decision_id).toBeUndefined();
  });

  it("401 maps to login_required, even with an HTML body", async () => {
    fetchMock.mockResolvedValue(html(401));
    await expect(fileModerationReport(input)).rejects.toThrow("login_required");
  });

  it("surfaces the worker's error, else the status", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: "rate_limited" }));
    await expect(fileModerationReport(input)).rejects.toThrow("rate_limited");
    fetchMock.mockResolvedValueOnce(html(502));
    await expect(fileModerationReport(input)).rejects.toThrow("Report failed (502)");
  });

  it("a 200 without report_id is a failure", async () => {
    fetchMock.mockResolvedValue(json(200, { queue: "moderation" }));
    await expect(fileModerationReport(input)).rejects.toThrow("Report failed (200)");
  });
});

describe("fetchOpenReports", () => {
  it("lists up to 50 open reports", async () => {
    fetchMock.mockResolvedValue(json(200, { reports: [report] }));
    await expect(fetchOpenReports()).resolves.toEqual([report]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/reports?limit=50");
  });

  it("is empty when the payload has no reports", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await expect(fetchOpenReports()).resolves.toEqual([]);
  });

  it.each([401, 403, 500, 502])("is empty (not a throw) on %i, even with an HTML body", async (status) => {
    fetchMock.mockResolvedValue(html(status));
    await expect(fetchOpenReports()).resolves.toEqual([]);
  });
});

describe("resolveModerationReport", () => {
  it("POSTs action + note to the encoded report id and returns the report", async () => {
    const resolved = { ...report, status: "resolved", resolve_note: "ok" };
    fetchMock.mockResolvedValue(json(200, { report: resolved }));
    await expect(resolveModerationReport("r/1 x", "hide_comment", "ok")).resolves.toEqual(
      resolved,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/reports/r%2F1%20x/resolve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "hide_comment", note: "ok" });
  });

  it("401 maps to login_required", async () => {
    fetchMock.mockResolvedValue(json(401, { error: "unauthorized" }));
    await expect(resolveModerationReport("r1", "dismiss")).rejects.toThrow("login_required");
  });

  it("surfaces the worker's error, else the status", async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: "not_a_reviewer" }));
    await expect(resolveModerationReport("r1", "dismiss")).rejects.toThrow("not_a_reviewer");
    fetchMock.mockResolvedValueOnce(html(503));
    await expect(resolveModerationReport("r1", "dismiss")).rejects.toThrow(
      "Resolve failed (503)",
    );
  });

  it("a 200 without a report is a failure", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await expect(resolveModerationReport("r1", "escalate_listing")).rejects.toThrow(
      "Resolve failed (200)",
    );
  });
});
