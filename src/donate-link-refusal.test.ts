/**
 * Donate modal: when /contributions/record or /contributions/claim refuses
 * (409, other 4xx, 2xx with ok:false) or fails (5xx, network), the modal shows
 * one fixed line and never the server's raw text.
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

import { bindDonatePanel, DONATE_LINK_REFUSED_COPY, donateModalHtml } from "./proposal-ui";

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const PID = "PLEBLY-2026-009";
const PATH = "proposals/listed/PLEBLY-2026-009.md";
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const NEW = { txid: "ef".repeat(32), vout: 1, value: 7_000, status: { confirmed: true } };
const POLL = 50;
const LINE = "Your gift reached escrow. This page couldn't link it to your account.";

type Reply = () => Response | Error;
const accepted: Reply = () => Response.json({ ok: true, entry: {} });

function stubFetch(record: Reply, claim: Reply) {
  let utxos = [OLD];
  const posts: string[] = [];
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
        posts.push(path);
        const r = path === "/contributions/claim" ? claim() : path === "/contributions/record" ? record() : accepted();
        if (r instanceof Error) throw r;
        return r;
      }
      return Response.json({ ok: true });
    }),
  );
  return {
    posts,
    arrive: () => {
      utxos = [OLD, NEW];
    },
  };
}

async function payAndDetect(h: ReturnType<typeof stubFetch>): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.body.innerHTML = donateModalHtml(
    { id: PID, path: PATH, title: "U", status: "listed", escrow_address: ADDR } as never,
    { signedIn: true },
  );
  await bindDonatePanel(document, {
    address: ADDR,
    proposalId: PID,
    proposalPath: PATH,
    signedIn: true,
    initialBalance: null,
    balancePollMs: 60_000,
    utxoPollMs: POLL,
  });
  await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
  document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
  await vi.advanceTimersByTimeAsync(POLL * 2);
  h.arrive();
  // claimContributionWithRetry: up to 6 attempts, 2.5 s apart.
  await vi.advanceTimersByTimeAsync(20_000);
}

const statusText = () => document.querySelector("#donate-confirm-status")?.textContent || "";
const pageText = () => document.body.textContent || "";

afterEach(() => {
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
});

describe("Donate modal: record/claim refusal shows one fixed line", () => {
  it("copy is exact", () => {
    expect(DONATE_LINK_REFUSED_COPY).toBe(LINE);
  });

  const cases: [string, Reply, Reply, string | null][] = [
    [
      "record 409",
      () => Response.json({ error: "contribution already recorded by another donor", code: "contribution_owned" }, { status: 409 }),
      accepted,
      "contribution already recorded by another donor",
    ],
    [
      "claim 409",
      accepted,
      () => Response.json({ error: "contribution claim conflict with github:alice" }, { status: 409 }),
      "github:alice",
    ],
    [
      "claim 400 already claimed by another user",
      accepted,
      () => Response.json({ error: "contribution already claimed by another user" }, { status: 400 }),
      "already claimed by another user",
    ],
    [
      "claim 2xx ok:false",
      accepted,
      () => Response.json({ ok: false, error: "not accepted: owner mismatch" }),
      "owner mismatch",
    ],
    [
      "record 2xx ok:false",
      () => Response.json({ ok: false, error: "record refused for bob" }),
      accepted,
      "record refused for bob",
    ],
    ["claim 503", accepted, () => new Response(JSON.stringify({ error: "upstream kv timeout" }), { status: 503 }), "upstream kv timeout"],
    ["claim network error", accepted, () => new TypeError("Failed to fetch"), "Failed to fetch"],
  ];

  for (const [name, record, claim, raw] of cases) {
    it(`${name} -> fixed line, no raw server text, no "Credit linked"`, async () => {
      const h = stubFetch(record, claim);
      await payAndDetect(h);
      expect(h.posts).toContain("/contributions/record");
      expect(statusText()).toBe(LINE);
      if (raw) expect(pageText()).not.toContain(raw);
      expect(pageText()).not.toMatch(/credit linked/i);
    });
  }

  it("accepted record + claim still says Credit linked", async () => {
    const h = stubFetch(accepted, accepted);
    await payAndDetect(h);
    expect(statusText()).toContain("Credit linked for 7,000 sats");
    expect(pageText()).not.toContain(LINE);
  });
});
