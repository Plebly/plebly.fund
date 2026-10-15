import { afterEach, describe, expect, it, vi } from "vitest";
import { amountsMatchCard, computeMonthlyFeeOutput, splitWorkOutput } from "./signing-verify";
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

  it("rejects an extra output on a monthly release", () => {
    const disbursed = 100_000;
    const fee = computeMonthlyFeeOutput(disbursed);
    const platform = Math.floor((disbursed * 3) / 100);
    const lines = disbursed - fee;
    const payout = [
      { label: "builder", amount_sats: 60_000 },
      { label: "builder", amount_sats: lines - 60_000 },
      { label: "platform fee", amount_sats: platform },
      { label: "keyholder pool", amount_sats: fee - platform },
    ];
    const match = amountsMatchCard({
      kind: "release",
      recompute: { disbursed_sats: disbursed },
      outputs: payout,
    });
    expect(match.ok).toBe(true);

    const extraBuilder = amountsMatchCard({
      kind: "release",
      recompute: { disbursed_sats: disbursed },
      outputs: [...payout, { label: "builder", amount_sats: 10_000 }],
    });
    expect(extraBuilder).toEqual({ ok: false, error: "unexpected output" });

    const extraLabel = amountsMatchCard({
      kind: "release",
      recompute: { disbursed_sats: disbursed },
      outputs: [...payout, { label: "bonus", amount_sats: 1 }],
    });
    expect(extraLabel).toEqual({ ok: false, error: "unexpected output" });
  });

  describe("monthly release lines", () => {
    const disbursed = 100_000;
    const fee = computeMonthlyFeeOutput(disbursed);
    const platform = Math.floor((disbursed * 3) / 100);
    const lines = disbursed - fee;
    const payout = [
      { label: "fulfiller payout:p1", amount_sats: 60_000 },
      { label: "fulfiller payout:p2", amount_sats: lines - 60_000 },
      { label: "platform fee", amount_sats: platform },
      { label: "keyholder pool", amount_sats: fee - platform },
    ];

    const ESCROW = "tb1qescrowaddress";
    const changeOut = { label: "escrow change:p1", amount_sats: 20_000, address: ESCROW };

    it("accepts a monthly release that returns 20k change to the escrow", () => {
      const outputs = [...payout, changeOut];
      expect(
        amountsMatchCard({
          kind: "release",
          recompute: { disbursed_sats: disbursed, input_sats: disbursed + 21_000, escrow_address: ESCROW },
          outputs,
        }),
      ).toEqual({ ok: true });
    });

    it("accepts a monthly release without change when input total and escrow are absent", () => {
      expect(
        amountsMatchCard({ kind: "release", recompute: { disbursed_sats: disbursed }, outputs: payout }),
      ).toEqual({ ok: true });
    });

    it("rejects escrow change when the card has no input total", () => {
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed, escrow_address: ESCROW },
        outputs: [...payout, changeOut],
      });
      expect(r).toEqual({ ok: false, error: "escrow change without input total" });
    });

    it("rejects escrow change when the card has no escrow address", () => {
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed, input_sats: disbursed + 21_000 },
        outputs: [...payout, changeOut],
      });
      expect(r).toEqual({ ok: false, error: "escrow change without escrow address" });
    });

    it("rejects escrow change paying a different address", () => {
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed, input_sats: disbursed + 21_000, escrow_address: ESCROW },
        outputs: [...payout, { ...changeOut, address: "tb1qsomethingelse" }],
      });
      expect(r).toEqual({ ok: false, error: "escrow change does not pay the escrow address" });
    });

    it("rejects escrow change larger than the escrow inputs allow", () => {
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed, input_sats: disbursed + 19_000, escrow_address: ESCROW },
        outputs: [...payout, changeOut],
      });
      expect(r).toEqual({ ok: false, error: "escrow change exceeds the escrow budget" });
    });

    it("rejects payout lines that fall short of the disbursed total", () => {
      const short = payout.map((o, i) => (i === 1 ? { ...o, amount_sats: o.amount_sats - 5_000 } : o));
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed },
        outputs: short,
      });
      expect(r).toEqual({ ok: false, error: "unexpected output" });
    });

    it("rejects a monthly fee mismatch", () => {
      const low = payout.map((o) =>
        o.label === "keyholder pool" ? { ...o, amount_sats: o.amount_sats - 1_000 } : o,
      );
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed },
        outputs: low,
      });
      expect(r).toEqual({ ok: false, error: "monthly fee does not match" });
    });
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
