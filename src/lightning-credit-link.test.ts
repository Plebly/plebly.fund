import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIGHTNING_LINK_FAILED_COPY,
  LIGHTNING_LINK_REFUSED_COPY,
  linkLightningCredit,
  type DonateBindOpts,
} from "./proposal-ui";

/** 5xx / network / not indexed yet (503): try again later, with Retry. */
const EXACT =
  "Your Lightning payment went through. Your funder credit isn't showing yet. Try again in a few minutes.";
/** 4xx refusal (UI UX): final, no Retry. */
const REFUSED = "Your Lightning payment went through, but we couldn't link it to your account.";
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

  it("exports the exact refusal line", () => {
    expect(LIGHTNING_LINK_REFUSED_COPY).toBe(REFUSED);
  });

  /** Server text must appear nowhere: visible text, any attribute, page HTML (body markup). */
  function expectNoServerText(): void {
    const attrs = [...document.querySelectorAll("*")].flatMap((el) =>
      [...el.attributes].map((a) => `${a.name}=${a.value}`),
    );
    for (const needle of ["already claimed", "github:777", "Failed to fetch", "swap indexes", "<html>"]) {
      expect(document.body.textContent).not.toContain(needle);
      expect(attrs.filter((v) => v.includes(needle))).toEqual([]);
      expect(document.body.innerHTML).not.toContain(needle);
    }
  }

  /** Settled payment: amber "warn", never the red "bad" class. */
  function expectWarnStyle(): void {
    expect(status().classList.contains("warn")).toBe(true);
    expect(status().classList.contains("bad")).toBe(false);
  }

  it.each([
    ["409 already claimed", json(409, { error: SERVER })],
    ["409 contribution_owned", json(409, { error: "contribution recorded by github:777", code: "contribution_owned" })],
    ["400 refusal", json(400, { error: SERVER })],
    ["403 refusal", json(403, { error: SERVER })],
    ["401 signed out", json(401, { error: "unauthorized github:777" })],
    ["404 other 4xx", json(404, { error: "not found github:777" })],
  ])("4xx %s → refusal line, NO Retry, no server text, warn style", async (_n, reply) => {
    replies = [reply];
    const o = opts();
    await run(o);
    expect(status().hidden).toBe(false);
    expect(status().textContent).toBe(REFUSED);
    expect(retry()).toBeNull();
    expect(panel().querySelectorAll("button")).toHaveLength(0);
    expectWarnStyle();
    expectNoServerText();
    expect(o.onCreditLinked).not.toHaveBeenCalled();
  });

  it.each([
    ["503 with JSON error", json(503, { error: SERVER })],
    ["503 not indexed yet (workers#90)", json(503, { error: `contribution not found ${SERVER}`, code: "contribution_not_indexed" })],
    ["503 claim busy (workers#90)", json(503, { error: SERVER, code: "contribution_busy" })],
    ["500 empty body", async () => new Response("", { status: 500 })],
    ["502 HTML page", async () => new Response(`<html>${SERVER}</html>`, { status: 502, headers: { "content-type": "text/html" } })],
    ["network error", async () => Promise.reject(new TypeError(`Failed to fetch ${SERVER}`))],
  ])("%s → try-again line + one Retry, no server text, warn style", async (_n, reply) => {
    replies = [reply];
    const o = opts();
    await run(o);
    expect(status().hidden).toBe(false);
    expect(status().textContent).toBe(EXACT);
    expect(retry()?.textContent).toBe("Retry");
    expect(panel().querySelectorAll("#donate-ln-credit-retry")).toHaveLength(1);
    expectWarnStyle();
    expectNoServerText();
    expect(o.onCreditLinked).not.toHaveBeenCalled();
  });

  it("the warn style is amber in CSS, not the red --bad colour", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "style.css"), "utf8");
    const rule = css.match(/\.donate-credit-status\.warn[^{]*\{([^}]*)\}/);
    expect(rule, ".donate-credit-status.warn rule").not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--overfund\)/);
    expect(rule![1]).not.toMatch(/--bad/);
  });

  it("5xx then a 4xx on Retry: the Retry goes away and the refusal line shows", async () => {
    replies = [json(503, { error: SERVER })];
    await run(opts());
    expect(retry()).not.toBeNull();
    replies = [json(409, { error: SERVER })];
    retry()!.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(status().textContent).toBe(REFUSED);
    expect(retry()).toBeNull();
    expectWarnStyle();
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
    replies = [json(503, { error: SERVER })];
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
