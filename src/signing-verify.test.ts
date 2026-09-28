import { describe, expect, it } from "vitest";
import { amountsMatchCard, splitWorkOutput } from "./signing-verify";

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
