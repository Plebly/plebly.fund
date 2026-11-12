import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_LLMS_SIGNET_NOTICES,
  LLMS_SIGNET_NOTICE,
  withNetworkNotice,
} from "../scripts/llms-network-notice.mjs";

const publicDir = join(__dirname, "..", "public");
const llms = readFileSync(join(publicDir, "llms.txt"), "utf8");
const llmsFull = readFileSync(join(publicDir, "llms-full.txt"), "utf8");

describe("signet test-network notice", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("shows on the home page and up front in llms files on signet", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const { signetSiteBannerHtml } = await import("./signet");
    const { landingMarketingHtml } = await import("./home-page");

    const banner = signetSiteBannerHtml();
    expect(banner).toContain('class="signet-banner"');
    expect(banner).toContain('aria-label="Signet test network"');
    expect(banner).not.toContain('role="status"');
    expect(banner).toContain("test coins only");
    const home = landingMarketingHtml();
    expect(home).toContain("Signet · test coins");
    expect(home).toContain("signet-hero-note");

    const outLlms = withNetworkNotice(llms, "signet", "llms");
    const outFull = withNetworkNotice(llmsFull, "signet", "full");
    for (const out of [outLlms, outFull]) {
      expect(out).toContain(LLMS_SIGNET_NOTICE);
      // Up front: before any "##" section.
      expect(out.indexOf(LLMS_SIGNET_NOTICE)).toBeLessThan(out.indexOf("\n## "));
    }
    // llms.txt keeps H1 then summary blockquote first (llmstxt.org shape).
    const lines = outLlms.split("\n");
    expect(lines[0]).toBe("# Plebly");
    expect(lines[2].startsWith("> ")).toBe(true);
    expect(lines[4]).toBe(LLMS_SIGNET_NOTICE);
    expect(outFull.split("\n")[2]).toBe(LLMS_SIGNET_NOTICE);
    // Idempotent across repeated builds.
    expect(withNetworkNotice(outLlms, "signet", "llms")).toBe(outLlms);
    expect(withNetworkNotice(outFull, "signet", "full")).toBe(outFull);
  });

  it("does not claim a shared escrow, and replaces an old-notice copy", () => {
    // Escrow sharing is per listing (catalog escrow_shared); the signet Worker
    // runs multisig with an address per listing.
    expect(LLMS_SIGNET_NOTICE).not.toMatch(/share one (test )?escrow/i);
    for (const legacy of LEGACY_LLMS_SIGNET_NOTICES) {
      for (const [src, kind] of [
        [llms, "llms"],
        [llmsFull, "full"],
      ] as const) {
        const oldCopy = withNetworkNotice(src, "signet", kind).replace(
          LLMS_SIGNET_NOTICE,
          legacy,
        );
        expect(oldCopy).toContain(legacy);
        const rebuilt = withNetworkNotice(oldCopy, "signet", kind);
        expect(rebuilt).toBe(withNetworkNotice(src, "signet", kind));
        expect(rebuilt).not.toContain(legacy);
        expect(rebuilt.split(LLMS_SIGNET_NOTICE).length).toBe(2);
        expect(withNetworkNotice(oldCopy, "mainnet", kind)).toBe(src);
      }
    }
  });

  it("does not appear on mainnet, even from a signet-built copy", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "mainnet");
    const { signetSiteBannerHtml } = await import("./signet");
    const { landingMarketingHtml } = await import("./home-page");

    expect(signetSiteBannerHtml()).toBe("");
    const home = landingMarketingHtml();
    expect(home).not.toContain("signet");
    expect(home).not.toContain("Signet");
    expect(home).toContain("Mainnet");

    for (const [src, kind] of [
      [llms, "llms"],
      [llmsFull, "full"],
    ] as const) {
      expect(withNetworkNotice(src, "mainnet", kind)).toBe(src);
      const signetCopy = withNetworkNotice(src, "signet", kind);
      const back = withNetworkNotice(signetCopy, "mainnet", kind);
      expect(back).toBe(src);
      expect(back).not.toContain(LLMS_SIGNET_NOTICE);
    }
  });
});
