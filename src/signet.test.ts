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
    expect(banner).toContain("not mainnet");
    for (const f of SIGNET_FAUCETS) {
      expect(banner).toContain(f.url);
      expect(banner).toContain(f.label);
    }
    expect(signetHeroNoteHtml()).toContain("Soft launch on");
    expect(signetHeroNoteHtml()).toContain("signet</strong> (test network)");
    expect(signetPayNoteHtml("donate")).toContain("mainnet payments will not credit");
    expect(signetPayNoteHtml("fee")).toContain("signet</strong> wallet");
  });

  it("does not claim a shared escrow on network-wide chrome", async () => {
    // Sharing is per listing (catalog escrow_shared); the live signet Worker
    // runs multisig with an address per listing. Pages that know a row is
    // shared show their own note (home sharedEscrowNoteHtml, donate copy).
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const { signetSiteBannerHtml, signetHeroNoteHtml, signetPayNoteHtml } =
      await import("./signet");
    for (const html of [
      signetSiteBannerHtml(),
      signetHeroNoteHtml(),
      signetPayNoteHtml("donate"),
      signetPayNoteHtml("fee"),
    ]) {
      expect(html).not.toMatch(/share one (test )?escrow/i);
      expect(html).not.toContain("separate pots");
    }
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
