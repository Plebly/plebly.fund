import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIGHTNING_LINK_FAILED_COPY, linkLightningCredit, type DonateBindOpts } from "./proposal-ui";

const EXACT =
  "Your Lightning payment went through. We couldn't link it to your account yet. Try again in a few minutes.";
const SERVER = "already claimed by another user (github:777)";

type Reply = () => Promise<Response>;
let replies: Reply[];
let claimCalls: number;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/contributions/claim")) {
    claimCalls += 1;
    const next = replies.length > 1 ? replies.shift()! : replies[0];
    return next();
  }
  return new Response("not mocked", { status: 599 });
});

const panelHtml = `<div id="panel"><div id="donate-credit-status" class="donate-credit-status" aria-live="polite" hidden></div></div>`;
const panel = () => document.querySelector<HTMLElement>("#panel")!;
const status = () => panel().querySelector<HTMLElement>("#donate-credit-status")!;
const retry = () => panel().querySelector<HTMLButtonElement>("#donate-ln-credit-retry");

const opts = (over: Partial<DonateBindOpts> = {}): DonateBindOpts =>
  ({
    address: "tb1qx",
    proposalId: "PLEBLY-2026-012",
    proposalPath: "proposals/listed/PLEBLY-2026-012.md",
    proposalTitle: "T",
    signedIn: true,
    onCreditLinked: vi.fn(),
    ...over,
  }) as DonateBindOpts;

async function run(o: DonateBindOpts) {
  const p = linkLightningCredit(panel(), o, "swap-1");
  await vi.advanceTimersByTimeAsync(60_000);
  await p;
}

const json = (status: number, body: unknown): Reply => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  document.body.innerHTML = panelHtml;
  replies = [];
  claimCalls = 0;
  fetchMock.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Lightning credit link failure copy", () => {
  it("exports the exact line", () => {
    expect(LIGHTNING_LINK_FAILED_COPY).toBe(EXACT);
  });

  it.each([
    ["409 already claimed", json(409, { error: SERVER })],
    ["400 refusal", json(400, { error: SERVER })],
    ["403 refusal", json(403, { error: SERVER })],
    ["503 with JSON error", json(503, { error: SERVER })],
    ["502 HTML page", async () => new Response(`<html>${SERVER}</html>`, { status: 502, headers: { "content-type": "text/html" } })],
    ["network error", async () => Promise.reject(new TypeError(`Failed to fetch ${SERVER}`))],
  ])("%s → exact line + Retry, no server text", async (_n, reply) => {
    replies = [reply];
    const o = opts();
    await run(o);
    expect(status().hidden).toBe(false);
    expect(status().textContent).toBe(EXACT);
    expect(status().classList.contains("bad")).toBe(true);
    expect(panel().textContent).not.toContain("already claimed");
    expect(panel().textContent).not.toContain("github:777");
    expect(panel().textContent).not.toMatch(/swap indexes/i);
    expect(panel().textContent).not.toContain("Failed to fetch");
    expect(retry()?.textContent).toBe("Retry");
    expect(o.onCreditLinked).not.toHaveBeenCalled();
  });

  it("Retry re-attempts the link; success shows the normal credit state and removes Retry", async () => {
    // 503s are retried 6 times inside claimContributionWithRetry, then Retry.
    const down = json(503, { error: "swap not indexed yet (internal)" });
    replies = [down, down, down, down, down, down, json(200, { ok: true })];
    const o = opts();
    await run(o);
    expect(status().textContent).toBe(EXACT);
    expect(panel().textContent).not.toContain("internal");
    expect(claimCalls).toBe(6);
    const before = claimCalls;
    retry()!.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(claimCalls).toBe(before + 1);
    expect(status().textContent).toBe("Lightning credit linked.");
    expect(status().classList.contains("ok")).toBe(true);
    expect(retry()).toBeNull();
    expect(o.onCreditLinked).toHaveBeenCalledTimes(1);
  });

  it("a failed Retry shows the same line with one Retry button (no stacking)", async () => {
    replies = [json(409, { error: SERVER })];
    await run(opts());
    retry()!.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(status().textContent).toBe(EXACT);
    expect(panel().querySelectorAll("#donate-ln-credit-retry")).toHaveLength(1);
  });

  it("first-try success: normal credit state, no Retry", async () => {
    replies = [json(200, { ok: true })];
    const o = opts();
    await run(o);
    expect(status().textContent).toBe("Lightning credit linked.");
    expect(retry()).toBeNull();
    expect(o.onCreditLinked).toHaveBeenCalledTimes(1);
  });

  it("signed out: does nothing (no claim call, no status)", async () => {
    replies = [json(200, { ok: true })];
    await run(opts({ signedIn: false }));
    expect(claimCalls).toBe(0);
    expect(status().hidden).toBe(true);
  });
});
