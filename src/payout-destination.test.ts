import { afterEach, describe, expect, it, vi } from "vitest";

describe("payoutLooksValid", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts Lightning Address when lightning UI allowed", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "mainnet");
    vi.stubEnv("VITE_LIGHTNING", "1");
    const { payoutLooksValid, isLightningPayoutDestination } = await import(
      "./payout-destination"
    );
    expect(isLightningPayoutDestination("satoshi@getalby.com")).toBe(true);
    expect(payoutLooksValid("satoshi@getalby.com", "lightning")).toBe(true);
  });

  it("exports the bounty on-chain-only apply error", async () => {
    const { BOUNTY_ONCHAIN_PAYOUT_ERROR } = await import("./payout-destination");
    expect(BOUNTY_ONCHAIN_PAYOUT_ERROR).toMatch(/presigned PSBT/i);
    expect(BOUNTY_ONCHAIN_PAYOUT_ERROR).toMatch(/Direct campaign/i);
  });

  it("rejects Lightning on signet", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const { payoutLooksValid } = await import("./payout-destination");
    expect(payoutLooksValid("satoshi@getalby.com", "lightning")).toBe(false);
  });
});

describe("account payout fail-closed gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("distinguishes missing omit vs needs explicit clear vs invalid", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const {
      gateAccountPayoutSave,
      payoutInvalidReason,
      accountPayoutMissingMessage,
    } = await import("./payout-destination");

    expect(gateAccountPayoutSave({ raw: "  ", previous: "" })).toEqual({
      ok: true,
      mode: "omit",
    });

    const blocked = gateAccountPayoutSave({
      raw: "",
      previous: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.kind).toBe("needs_explicit_clear");
      expect(blocked.message).toMatch(/Clear receive address/i);
    }

    const cleared = gateAccountPayoutSave({
      raw: "",
      previous: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      allowClear: true,
    });
    expect(cleared).toEqual({ ok: true, mode: "clear" });

    const invalid = gateAccountPayoutSave({
      raw: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      previous: "",
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.kind).toBe("invalid");
      expect(invalid.message).toMatch(/mainnet/i);
      expect(invalid.message).toMatch(/signet/i);
    }

    const ln = payoutInvalidReason("satoshi@getalby.com");
    expect(ln).toMatch(/Lightning/i);
    expect(ln).toMatch(/signet/i);

    const garbage = payoutInvalidReason("not-an-address");
    expect(garbage).toMatch(/Invalid receive address/i);
    expect(garbage).toMatch(/tb1/i);

    expect(accountPayoutMissingMessage()).toMatch(/not set yet/i);
    expect(accountPayoutMissingMessage()).toMatch(/signet/i);
  });

  it("accepts signet tb1 and labels placeholder/hint", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const {
      gateAccountPayoutSave,
      accountPayoutPlaceholder,
      accountPayoutHint,
      payoutLooksValid,
    } = await import("./payout-destination");

    const addr = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
    expect(payoutLooksValid(addr)).toBe(true);
    expect(gateAccountPayoutSave({ raw: addr, previous: "" })).toEqual({
      ok: true,
      mode: "set",
      payout_address: addr,
    });
    expect(accountPayoutPlaceholder()).toBe("tb1…");
    expect(accountPayoutHint()).toMatch(/signet/i);
    expect(accountPayoutHint()).toMatch(/tb1/i);
    expect(accountPayoutHint()).toMatch(/Lightning not allowed/i);
  });
});
