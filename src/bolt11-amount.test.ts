import { describe, expect, it } from "vitest";
import {
  assertLightningSwapMatches,
  bolt11AmountSats,
} from "./bolt11-amount";

describe("bolt11AmountSats", () => {
  it("decodes micro-bitcoin amounts", () => {
    // 2500u BTC = 250_000 sats
    expect(bolt11AmountSats("lnbc2500u1pvjluezpp5...")).toBe(250_000);
  });

  it("returns null for amount-less invoices", () => {
    expect(bolt11AmountSats("lnbc1pvjluez...")).toBeNull();
  });
});

describe("assertLightningSwapMatches", () => {
  it("accepts matching swap", () => {
    expect(() =>
      assertLightningSwapMatches(
        {
          bolt11: "lnbc1000u1xyz",
          invoice_amount_sats: 100_000,
          escrow_address: "bc1qabc",
        },
        { amount_sats: 100_000, escrow_address: "bc1qabc" },
        "mainnet",
      ),
    ).not.toThrow();
  });

  it("rejects amount-less bolt11 even if API claims amount", () => {
    expect(() =>
      assertLightningSwapMatches(
        {
          bolt11: "lnbc1pvjluez...",
          invoice_amount_sats: 100_000,
          escrow_address: "bc1qabc",
        },
        { amount_sats: 100_000, escrow_address: "bc1qabc" },
        "mainnet",
      ),
    ).toThrow(/amount-less/);
  });

  it("rejects wrong network prefix", () => {
    expect(() =>
      assertLightningSwapMatches(
        {
          bolt11: "lntb1000u1xyz",
          invoice_amount_sats: 100_000,
          escrow_address: "bc1qabc",
        },
        { amount_sats: 100_000, escrow_address: "bc1qabc" },
        "mainnet",
      ),
    ).toThrow(/network mismatch/);
  });

  it("rejects escrow or amount mismatch", () => {
    expect(() =>
      assertLightningSwapMatches(
        {
          bolt11: "lnbc1000u1xyz",
          invoice_amount_sats: 100_000,
          escrow_address: "bc1qevil",
        },
        { amount_sats: 100_000, escrow_address: "bc1qabc" },
        "mainnet",
      ),
    ).toThrow(/escrow_address/);
    expect(() =>
      assertLightningSwapMatches(
        {
          bolt11: "lnbc2000u1xyz",
          invoice_amount_sats: 200_000,
          escrow_address: "bc1qabc",
        },
        { amount_sats: 100_000, escrow_address: "bc1qabc" },
        "mainnet",
      ),
    ).toThrow(/amount mismatch/);
  });
});
