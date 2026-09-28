import { afterEach, describe, expect, it, vi } from "vitest";
import { amountsMatchCard, splitWorkOutput } from "./signing-verify";
import fixture from "./fixtures/signet-structure-001.json";

describe("signing verify", () => {
  it("blocks a tampered builder amount", () => {
    const work = 100_000;
    const split = splitWorkOutput(work, 4);
    const ok = amountsMatchCard({
      kind: "clean",
      recompute: { work_sats: work },
      outputs: [
        { label: "builder", amount_sats: split.clean_builder_sats },
        { label: "bdi_fee", amount_sats: split.bdi_sats },
        { label: "ops_fee", amount_sats: split.ops_sats },
        { label: "kh_fee", amount_sats: split.kh_sats },
      ],
    });
    expect(ok.ok).toBe(true);
    const tampered = amountsMatchCard({
      kind: "clean",
      recompute: { work_sats: work },
      outputs: [
        { label: "builder", amount_sats: split.clean_builder_sats + 1 },
        { label: "bdi_fee", amount_sats: split.bdi_sats },
        { label: "ops_fee", amount_sats: split.ops_sats },
        { label: "kh_fee", amount_sats: split.kh_sats },
      ],
    });
    expect(tampered.ok).toBe(false);
  });

  it("uses the frozen miner fee for a refund", () => {
    const match = amountsMatchCard({
      kind: "refund",
      recompute: { input_sats: 80_000, miner_fee_sats: 2_000 },
      outputs: [{ label: "pool", amount_sats: 78_000 }],
    });
    expect(match.ok).toBe(true);
    const bad = amountsMatchCard({
      kind: "refund",
      recompute: { input_sats: 80_000, miner_fee_sats: 2_000 },
      outputs: [{ label: "pool", amount_sats: 79_000 }],
    });
    expect(bad.ok).toBe(false);
  });
});

describe("parsedPsbtOutputs network HRP", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("encodes Signet PSBT outputs as tb1 matching published decode", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "signet");
    const { parsedPsbtOutputs, outputsMatchPublished } = await import("./signing-verify");
    const parsed = await parsedPsbtOutputs(fixture.psbt_base64);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.every((o) => o.address.startsWith("tb1"))).toBe(true);
    expect(
      outputsMatchPublished(
        parsed,
        fixture.outputs.map((o) => ({ address: o.address, amount_sats: o.amount_sats })),
      ),
    ).toBe(true);
  });

  it("encodes the same scripts as bc1 on a mainnet build", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "mainnet");
    const { parsedPsbtOutputs } = await import("./signing-verify");
    const parsed = await parsedPsbtOutputs(fixture.psbt_base64);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.every((o) => o.address.startsWith("bc1"))).toBe(true);
  });
});
