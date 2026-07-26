import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addressUtxos = vi.fn();
vi.mock("./mempool", () => ({
  addressUtxos: (...args: unknown[]) => addressUtxos(...args),
  addressBalanceSats: vi.fn(async () => 0),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    WORKERS_API: "https://api.test",
  };
});

import {
  bindCreditPreferenceGates,
  claimContribution,
  claimContributionWithRetry,
  creditPreferenceFieldsHtml,
  hasStoredCreditPreferences,
  loadStoredCreditPreferences,
  readCreditPreferences,
  recordContribution,
  saveStoredCreditPreferences,
  updateCreditPreferences,
  utxoKey,
  watchNewUtxos,
} from "./funder-credit";

const storage = new Map<string, string>();

beforeEach(() => {
  addressUtxos.mockReset();
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("stored credit preferences", () => {
  it("round-trips chosen prefs for the donate wizard skip", () => {
    expect(hasStoredCreditPreferences()).toBe(false);
    saveStoredCreditPreferences({
      public_credit: true,
      anonymous: false,
      show_amount: true,
    });
    expect(hasStoredCreditPreferences()).toBe(true);
    expect(loadStoredCreditPreferences()).toEqual({
      public_credit: true,
      anonymous: false,
      show_amount: true,
    });
  });

  it("forces amount off when anonymous", () => {
    saveStoredCreditPreferences({
      public_credit: false,
      anonymous: true,
      show_amount: true,
    });
    expect(loadStoredCreditPreferences()).toEqual({
      public_credit: false,
      anonymous: true,
      show_amount: false,
    });
  });
});

describe("creditPreferenceFieldsHtml", () => {
  it("uses the given id prefix", () => {
    const html = creditPreferenceFieldsHtml({ idPrefix: "donate-credit" });
    expect(html).toContain('id="donate-credit-public"');
    expect(html).toContain('id="donate-credit-amount"');
    expect(html).toContain("Show my identity");
  });
});

describe("readCreditPreferences + gates", () => {
  it("reads checkbox state and clears amount when public is off", () => {
    document.body.innerHTML = creditPreferenceFieldsHtml({ idPrefix: "donate-credit" });
    bindCreditPreferenceGates(document.body, "donate-credit");

    const publicBox = document.querySelector<HTMLInputElement>("#donate-credit-public")!;
    const amountBox = document.querySelector<HTMLInputElement>("#donate-credit-amount")!;
    amountBox.checked = true;
    expect(readCreditPreferences(document.body, "donate-credit")).toEqual({
      public_credit: true,
      anonymous: false,
      show_amount: true,
    });

    publicBox.checked = false;
    publicBox.dispatchEvent(new Event("change"));
    expect(amountBox.checked).toBe(false);
    expect(amountBox.disabled).toBe(true);
    expect(readCreditPreferences(document.body, "donate-credit")).toEqual({
      public_credit: false,
      anonymous: true,
      show_amount: false,
    });
  });
});

describe("utxoKey", () => {
  it("joins txid and vout", () => {
    expect(utxoKey({ txid: "abc", vout: 2 })).toBe("abc:2");
  });
});

describe("contribution API helpers", () => {
  it("POSTs record / claim / credit payloads", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await recordContribution({
      proposal_id: "PLEBLY-1",
      txid: "aa",
      vout: 0,
      address: "bc1q",
    });
    await claimContribution({
      proposal_id: "PLEBLY-1",
      txid: "aa",
      vout: 0,
      public_credit: true,
      anonymous: false,
      show_amount: false,
    });
    await updateCreditPreferences({
      proposal_id: "PLEBLY-1",
      swap_id: "swap-1",
      public_credit: false,
      anonymous: true,
      show_amount: false,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.test/contributions/record",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.test/contributions/claim",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.test/contributions/credit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces API error bodies", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "vout does not pay proposal address" }), {
        status: 400,
      }),
    );
    await expect(
      recordContribution({
        proposal_id: "PLEBLY-1",
        txid: "aa",
        vout: 0,
        address: "bc1q",
      }),
    ).rejects.toThrow("vout does not pay proposal address");
  });
});

describe("claimContributionWithRetry", () => {
  it("retries until the indexer catches up", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "contribution not found" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "contribution not found" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const pending = claimContributionWithRetry(
      {
        proposal_id: "PLEBLY-1",
        swap_id: "s1",
        public_credit: true,
        anonymous: false,
        show_amount: false,
      },
      { attempts: 3, delayMs: 50 },
    );

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry already-claimed errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "contribution already claimed by another user" }),
        { status: 400 },
      ),
    );
    await expect(
      claimContributionWithRetry(
        {
          proposal_id: "PLEBLY-1",
          txid: "aa",
          vout: 0,
          public_credit: true,
          anonymous: false,
          show_amount: false,
        },
        { attempts: 4, delayMs: 10 },
      ),
    ).rejects.toThrow("already claimed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("watchNewUtxos", () => {
  it("emits only UTXOs that appear after the baseline snapshot", async () => {
    vi.useFakeTimers();
    const onNew = vi.fn();
    addressUtxos
      .mockResolvedValueOnce([
        {
          txid: "old",
          vout: 0,
          value: 1,
          status: { confirmed: true },
        },
      ])
      .mockResolvedValue([
        {
          txid: "old",
          vout: 0,
          value: 1,
          status: { confirmed: true },
        },
        {
          txid: "new",
          vout: 1,
          value: 21_000,
          status: { confirmed: false },
        },
      ]);

    const watcher = watchNewUtxos("bc1q", onNew, { intervalMs: 25 });
    await watcher.ready;
    expect(onNew).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    await vi.waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(onNew.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ txid: "new", vout: 1, value: 21_000 }),
    ]);

    watcher.stop();
  });
});
