import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  branchSignDeskHtml,
  keyholderDeskHtml,
  keyholderDeskStep,
  keyholderColdStart,
  keyholderColdStartHtml,
  keyholderKeysFormHtml,
  keyholderOnboardHtml,
  keyholderOnboardLede,
  keyholderOnboardPhase,
  keyholderOnboardStepIndex,
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

describe("keyholder onboarding", () => {
  it("steps signed-out through apply to active", () => {
    expect(keyholderOnboardPhase({ signedIn: false, canApply: false })).toBe(
      "sign_in",
    );
    expect(
      keyholderOnboardPhase({ signedIn: true, canApply: false }),
    ).toBe("earn_reviewer");
    expect(
      keyholderOnboardPhase({ signedIn: true, canApply: true }),
    ).toBe("apply");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: true,
        application: { status: "pending" },
      }),
    ).toBe("election");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: false,
        keyholder: { status: "invited" },
      }),
    ).toBe("submit_keys");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: false,
        keyholder: { status: "pending_attest", attest_count: 1 },
      }),
    ).toBe("await_attest");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: true,
        keyholder: { status: "active" },
      }),
    ).toBe("active");
    expect(keyholderOnboardStepIndex("election")).toBe(2);
    expect(keyholderOnboardStepIndex("submit_keys")).toBe(3);
  });

  it("renders the current action only — no genesis, no seed", () => {
    const signedOut = keyholderOnboardHtml({
      signedIn: false,
      canApply: false,
    });
    expect(signedOut).toContain("Sign in to continue");
    expect(signedOut).toContain("is-current");
    expect(keyholderOnboardLede("sign_in")).toMatch(/Sign in/);

    const apply = keyholderOnboardHtml({ signedIn: true, canApply: true });
    expect(apply).toContain("kh-apply-form");
    expect(keyholderOnboardLede("submit_keys")).toContain(
      "does not update the Sparrow descriptor",
    );

    const keys = keyholderOnboardHtml({
      signedIn: true,
      canApply: false,
      keyholder: { status: "invited" },
    });
    expect(keys).toContain("kh-fp");
    expect(keys).toContain("Never paste a seed");
    expect(keys).not.toContain("genesis");
    expect(keys).not.toContain("HOOK_SECRET");

    const wait = keyholderOnboardHtml({
      signedIn: true,
      canApply: false,
      keyholder: {
        status: "pending_attest",
        fingerprint: "AABBCCDD",
        attest_count: 1,
      },
    });
    expect(wait).toContain("1/2");
    expect(wait).toContain("AABBCCDD");

    const form = keyholderKeysFormHtml({
      fingerprint: "11223344",
      xpub: "tpub1",
      heading: "Your keys",
    });
    expect(form).toContain("does not change the Sparrow descriptor");
    expect(form).not.toContain("mnemonic");
  });

  it("tells an empty roster that ops seats the first two", () => {
    expect(keyholderColdStart(0)).toBe(true);
    expect(keyholderColdStart(1)).toBe(true);
    expect(keyholderColdStart(2)).toBe(false);
    const empty = keyholderOnboardHtml({
      signedIn: false,
      canApply: false,
      activeSeats: 0,
    });
    expect(empty).toContain("First seats");
    expect(empty).toContain("Ops activates the first two together");
    expect(empty).not.toContain("genesis");
    expect(empty).not.toContain("HOOK_SECRET");
    expect(keyholderColdStartHtml(2)).toBe("");

    const stuck = keyholderOnboardHtml({
      signedIn: true,
      canApply: false,
      activeSeats: 0,
      keyholder: { status: "pending_attest", fingerprint: "AABBCCDD" },
    });
    expect(stuck).toContain("cannot start until two seats are already active");
  });
});
