import { afterEach, describe, expect, it, vi } from "vitest";

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
