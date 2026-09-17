import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLightningStatus,
  lightningAmountError,
  lightningFeeHint,
  lightningLimits,
  lightningStatusSentence,
  type LightningStatus,
} from "./lightning";

const status: LightningStatus = {
  enabled: true,
  processor: "opennode",
  limits: { minimal: 25_000, maximal: 10_000_000 },
  sweep: { chain_min_sats: 200_000, pending_min_sats: 207_000, fee_bps: 100 },
};

describe("lightning OpenNode copy", () => {
  it("uses processor limits", () => {
    expect(lightningLimits(status)).toEqual({ min: 25_000, max: 10_000_000 });
    expect(lightningAmountError(1_000, status)).toMatch(/at least/i);
    expect(lightningAmountError(20_000_000, status)).toMatch(/at most/i);
    expect(lightningAmountError(50_000, status)).toBeNull();
  });

  it("explains the batched sweep fee", () => {
    const hint = lightningFeeHint({ status, mode: "project" });
    expect(hint).toContain("OpenNode 1%");
    expect(hint).toContain("207,000");
    expect(hint).toContain("claim floor");
    expect(
      lightningFeeHint({
        status,
        mode: "endowment",
        expectedOnchainSats: 49_000,
      }),
    ).toMatch(/endowment/);
  });

  it("covers the OpenNode charge lifecycle", () => {
    expect(lightningStatusSentence("pending").text).toBe("Waiting for payment.");
    expect(lightningStatusSentence("pending").kind).toBe("live");
    expect(lightningStatusSentence("invoice_paid").text).toMatch(/OpenNode/);
    expect(lightningStatusSentence("invoice_paid").kind).toBe("live");
    expect(lightningStatusSentence("claiming", { endowment: true }).text).toMatch(
      /endowment/,
    );
    expect(lightningStatusSentence("settled").kind).toBe("ok");
    expect(lightningStatusSentence("expired").kind).toBe("bad");
    expect(lightningStatusSentence("failed", { error: "underpaid" }).text).toBe(
      "underpaid",
    );
  });
});

describe("lightning status cache", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reuses the Worker probe for five minutes", async () => {
    sessionStorage.clear();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          enabled: true,
          processor: "opennode",
          limits: { minimal: 25_000, maximal: 10_000_000 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await fetchLightningStatus();
    const second = await fetchLightningStatus();
    expect(first.enabled).toBe(true);
    expect(second.processor).toBe("opennode");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
