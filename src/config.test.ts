import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertParametersNetwork,
  expectedParametersNetwork,
  mempoolWeb,
  networkLabel,
} from "./config";

describe("lightningUiAllowed", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("is off on signet even with lightning flags", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    vi.stubEnv("VITE_LIGHTNING", "1");
    const { lightningUiAllowed } = await import("./config");
    expect(lightningUiAllowed()).toBe(false);
  });

  it("is on for mainnet", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "mainnet");
    const { lightningUiAllowed } = await import("./config");
    expect(lightningUiAllowed()).toBe(true);
  });

  it("allows explicit flag on testnet staging builds", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "testnet");
    vi.stubEnv("VITE_LIGHTNING_TESTNET", "1");
    const { lightningUiAllowed } = await import("./config");
    expect(lightningUiAllowed()).toBe(true);
  });
});

describe("assertParametersNetwork", () => {
  it("maps env to parameters overlay expectation", () => {
    expect(expectedParametersNetwork("mainnet")).toBe("mainnet");
    // testnet staging shares the signet parameter overlay (tb1 / floors).
    expect(expectedParametersNetwork("testnet")).toBe("signet");
    expect(expectedParametersNetwork("signet")).toBe("signet");
  });

  it("passes when generated matches expected", () => {
    expect(() =>
      assertParametersNetwork("signet", "signet", 10_000),
    ).not.toThrow();
  });

  it("throws on mismatch", () => {
    expect(() =>
      assertParametersNetwork("mainnet", "signet", 10_000),
    ).toThrow(/parameters network mismatch/);
  });

  it("labels and mempool web cover testnet", () => {
    expect(networkLabel("testnet")).toBe("testnet");
    expect(networkLabel("signet")).toBe("signet");
    expect(networkLabel("mainnet")).toBe("mainnet");
    expect(mempoolWeb("testnet")).toBe("https://mempool.space/testnet");
    expect(mempoolWeb("signet")).toBe("https://mempool.space/signet");
    expect(mempoolWeb("mainnet")).toBe("https://mempool.space");
  });
});
