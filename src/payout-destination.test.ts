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

  it("rejects Lightning on signet", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const { payoutLooksValid } = await import("./payout-destination");
    expect(payoutLooksValid("satoshi@getalby.com", "lightning")).toBe(false);
  });
});
