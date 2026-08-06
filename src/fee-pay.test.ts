import { afterEach, describe, expect, it, vi } from "vitest";

const addressUtxos = vi.fn();
vi.mock("./funder-credit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./funder-credit")>();
  return {
    ...actual,
    watchNewUtxos: (
      _address: string,
      onNew: (utxos: {
        txid: string;
        vout: number;
        value: number;
        status: { confirmed: boolean };
      }[]) => void,
    ) => {
      // Expose a one-shot hook for tests via addressUtxos mock side channel.
      queueMicrotask(async () => {
        const utxos = await addressUtxos();
        if (Array.isArray(utxos) && utxos.length) onNew(utxos);
      });
      return { stop: () => {}, ready: Promise.resolve() };
    },
  };
});

import { bindFeePay, feePayHtml } from "./fee-pay";

describe("feePayHtml", () => {
  it("embeds exact amount and address in BIP21 wallet link", () => {
    const html = feePayHtml({
      id: "propose-fee",
      amountSats: 10_000,
      address: "tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(html).toContain("tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx");
    expect(html).toContain("bitcoin:tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx?amount=0.0001");
    expect(html).toContain("10,000 sats");
    expect(html).toContain('data-amount="10000"');
    expect(html).toContain("detected automatically");
    expect(html).toContain("Enter txid manually");
    expect(html).not.toContain("I've sent it");
  });

  it("shows fallback copy when address missing", () => {
    const html = feePayHtml({
      id: "claim-bond",
      amountSats: 10_000,
      address: null,
    });
    expect(html).toContain("Fee address is not available from the API yet");
    expect(html).not.toContain("bitcoin:");
  });

  it("uses bond copy when kind is bond", () => {
    const html = feePayHtml({
      id: "claim-bond",
      amountSats: 10_000,
      address: null,
      kind: "bond",
    });
    expect(html).toContain("Send bond");
    expect(html).toContain("Bond address is not available from the API yet");
    expect(html).toContain('data-kind="bond"');
  });
});

describe("bindFeePay auto-detect", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    addressUtxos.mockReset();
  });

  it("fills txid when an exact-amount payment appears", async () => {
    const txid = "ab".repeat(32);
    addressUtxos.mockResolvedValue([
      {
        txid,
        vout: 0,
        value: 10_000,
        status: { confirmed: true },
      },
    ]);

    document.body.innerHTML = feePayHtml({
      id: "propose-fee",
      amountSats: 10_000,
      address: "tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx",
    });

    const binding = await bindFeePay(document, "propose-fee");
    expect(binding).toBeTruthy();

    await vi.waitFor(() => {
      expect(binding!.getTxid()).toBe(txid);
      expect(
        document.querySelector("#propose-fee-status")?.textContent,
      ).toContain("Fee payment detected");
      expect(
        document.querySelector("#propose-fee-step-txid")?.hasAttribute("hidden"),
      ).toBe(false);
    });

    binding!.stop();
  });
});
