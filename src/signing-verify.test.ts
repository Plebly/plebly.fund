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

    const ESC_1 = "tb1qescrowone";
    const ESC_2 = "tb1qescrowtwo";
    const map = {
      p1: { address: ESC_1, budget_sats: 20_000 },
      p2: { address: ESC_2, budget_sats: 8_000 },
    };
    const ch1 = { label: "escrow change:p1", amount_sats: 20_000, address: ESC_1 };
    const ch2 = { label: "escrow change:p2", amount_sats: 8_000, address: ESC_2 };
    const card = (outputs: typeof payout, escrow_by_proposal?: typeof map) => ({
      kind: "release",
      recompute: { disbursed_sats: disbursed, input_sats: disbursed + 30_000, escrow_by_proposal },
      outputs,
    });

    it("accepts a two-proposal month with change back to each escrow", () => {
      expect(amountsMatchCard(card([...payout, ch1, ch2], map))).toEqual({ ok: true });
    });

    it("accepts change addresses regardless of case and surrounding space", () => {
      const out = { ...ch1, address: `  ${ESC_1.toUpperCase()} ` };
      expect(amountsMatchCard(card([...payout, out, ch2], map))).toEqual({ ok: true });
    });

    it("accepts a release without change when no escrow limits are present", () => {
      expect(
        amountsMatchCard({ kind: "release", recompute: { disbursed_sats: disbursed }, outputs: payout }),
      ).toEqual({ ok: true });
    });

    it("rejects change when the card has no escrow limits", () => {
      expect(amountsMatchCard(card([...payout, ch1]))).toEqual({
        ok: false,
        error: "escrow change without escrow limits",
      });
    });

    it("rejects change for a proposal missing from the escrow limits", () => {
      const only1 = { p1: map.p1 } as typeof map;
      expect(amountsMatchCard(card([...payout, ch1, ch2], only1))).toEqual({
        ok: false,
        error: "escrow change without escrow limits",
      });
    });

    it("rejects change paid to another proposal's escrow", () => {
      const wrong = { ...ch2, address: ESC_1 };
      expect(amountsMatchCard(card([...payout, ch1, wrong], map))).toEqual({
        ok: false,
        error: "escrow change does not pay its escrow address",
      });
    });

    it("rejects change over that proposal's escrow budget", () => {
      const over = { ...ch2, amount_sats: 8_001 };
      expect(amountsMatchCard(card([...payout, ch1, over], map))).toEqual({
        ok: false,
        error: "escrow change exceeds the escrow budget",
      });
    });

    it("rejects change over the overall input total", () => {
      const r = amountsMatchCard({
        kind: "release",
        recompute: { disbursed_sats: disbursed, input_sats: disbursed + 19_000, escrow_by_proposal: map },
        outputs: [...payout, ch1],
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
