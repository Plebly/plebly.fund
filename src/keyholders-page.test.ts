import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  branchSignDeskHtml,
  keyholderDeskHtml,
  keyholderDeskStep,
  keyholderPackageSentence,
  keyholderTabFromSearch,
} from "./keyholders-page";
import { parseLocation, seoForRoute } from "./router";

describe("keyholders route", () => {
  it("parses /keyholders", () => {
    expect(parseLocation("/keyholders", "")).toEqual({ name: "keyholders" });
    const seo = seoForRoute({ name: "keyholders" });
    expect(seo.path).toBe("/keyholders");
    expect(seo.title).toMatch(/Keyholder/i);
    expect(keyholderTabFromSearch("?tab=branch")).toBe("branch");
    expect(keyholderTabFromSearch("")).toBe("release");
  });
});

describe("keyholderPackageSentence", () => {
  it("asks to sign a ready release and stays quiet otherwise", () => {
    expect(
      keyholderPackageSentence({
        kind: "release",
        outputs: [{ address: "tb1q", amount_sats: 1 }],
      }),
    ).toBe("Sign this release.");
    expect(
      keyholderPackageSentence({
        kind: "release",
        monthly_accruing: true,
        outputs: [{ address: "tb1q", amount_sats: 1 }],
      }),
    ).toBeNull();
    expect(keyholderPackageSentence({ kind: "release", outputs: [] })).toBeNull();
    expect(
      keyholderPackageSentence({
        kind: "refund",
        outputs: [{ address: "tb1q", amount_sats: 1 }],
      }),
    ).toBeNull();
  });

  it("steps a ready release: freeze, then sign, then broadcast", () => {
    expect(
      keyholderDeskStep({
        kind: "release",
        outputs: [{}],
        canUnsigned: true,
        canPartial: false,
        canBroadcast: false,
        isRelease: true,
        needsLn: false,
      }),
    ).toBe("freeze");
    expect(
      keyholderDeskStep({
        kind: "release",
        outputs: [{}],
        canUnsigned: false,
        canPartial: true,
        canBroadcast: false,
        isRelease: true,
        needsLn: false,
      }),
    ).toBe("sign");
    expect(
      keyholderDeskStep({
        kind: "release",
        outputs: [{}],
        canUnsigned: false,
        canPartial: true,
        canBroadcast: true,
        isRelease: true,
        needsLn: false,
      }),
    ).toBe("broadcast");
  });

  it("desk shows the current step and keeps sign/verify/output ids", () => {
    const html = keyholderDeskHtml(
      {
        kind: "release",
        proposal_id: "p1",
        state: "ready",
        outputs: [{ address: "tb1qout", amount_sats: 50_000, label: "builder" }],
        required_threshold: 3,
        partials: [],
      },
      {
        needsLn: false,
        canPsbt: true,
        canUnsigned: false,
        canPartial: true,
        canBroadcast: false,
        isRelease: true,
        requiresDualSettle: true,
        userId: "github:1",
      },
    );
    expect(html).toContain("Sign this release.");
    expect(html).toContain("kh-steps");
    expect(html).toContain("is-current");
    expect(html).toContain('id="kh-sign"');
    expect(html).toContain('id="kh-psbt-verify"');
    expect(html).toContain('id="kh-hash-status"');
    expect(html).toContain('id="kh-verify-panel"');
    expect(html).toContain("kh-outputs");
    expect(html).toContain("Other settle tools");
    expect(html).not.toContain("cHNidP8");
    expect(html).not.toContain("PSBT");
  });

  it("keeps outputs, verify, and sign markup on the console", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "keyholders-page.ts"),
      "utf8",
    );
    expect(src).toContain('id="kh-sign"');
    expect(src).toContain('id="kh-verify-panel"');
    expect(src).toContain("kh-verify-outputs");
    expect(src).toContain("kh-outputs");
    expect(src).toContain('data-kh-tab="branch"');
    expect(src).toContain("kh-branch-sign");
  });

  it("branch desk hash-gates sign and does not offer broadcast", () => {
    const html = branchSignDeskHtml({
      proposal_id: "p1",
      allocation_id: "bounty",
      kind: "clean",
      published_sha256: "aa".repeat(32),
      signed: 0,
      required_threshold: 2,
      state: "open",
      decode: {
        outputs: [{ address: "tb1qout", amount_sats: 50_000, label: "builder" }],
      },
    });
    expect(html).toContain("kh-branch-verify");
    expect(html).toContain("kh-branch-sign");
    expect(html).toContain("kh-branch-txid");
    expect(html).toContain("Propose settle");
    expect(html).toContain("does not broadcast");
    expect(html).not.toContain("Broadcast");
    expect(html).not.toContain("cHNidP8");
  });
});
