import { afterEach, describe, expect, it, vi } from "vitest";

describe("signet helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("renders site banner and faucet links on signet", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const {
      isSignet,
      signetSiteBannerHtml,
      signetHeroNoteHtml,
      signetPayNoteHtml,
      SIGNET_FAUCETS,
    } = await import("./signet");

    expect(isSignet()).toBe(true);
    const banner = signetSiteBannerHtml();
    expect(banner).toContain("signet-banner");
    expect(banner).toContain("test coins only");
    for (const f of SIGNET_FAUCETS) {
      expect(banner).toContain(f.url);
      expect(banner).toContain(f.label);
    }
    expect(signetHeroNoteHtml()).toContain("Soft launch on");
    expect(signetPayNoteHtml("donate")).toContain("mainnet payments will not credit");
    expect(signetPayNoteHtml("fee")).toContain("signet</strong> wallet");
  });

  it("hides signet chrome on mainnet", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "mainnet");
    const {
      isSignet,
      signetSiteBannerHtml,
      signetHeroNoteHtml,
      signetPayNoteHtml,
      signetFaucetLinksHtml,
    } = await import("./signet");

    expect(isSignet()).toBe(false);
    expect(signetSiteBannerHtml()).toBe("");
    expect(signetHeroNoteHtml()).toBe("");
    expect(signetPayNoteHtml()).toBe("");
    expect(signetFaucetLinksHtml()).toBe("");
  });
});
