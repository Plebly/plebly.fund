import { describe, expect, it } from "vitest";
import { partialRefundCopy, partialRefundHtml } from "./partial-refund";
import { structuredFundingBodyHtml } from "./proposal-structured-funding";

const COPY =
  "Partly refunded: 19,700 sats sent, 50,000 sats still owed. The rest will be refunded when more escrow funds are available.";
const owed = {
  owed_sats: 70_000,
  covered_sats: 20_000,
  outstanding_sats: 50_000,
  sent_sats: 19_700,
  settled: true,
};

describe("partial refund copy", () => {
  it("settled with something still owed: the agreed sentence, sent = donor-pool output", () => {
    expect(partialRefundCopy(owed)).toBe(COPY);
  });

  it("falls back to covered sats when the donor-pool output is missing", () => {
    const { sent_sats: _s, ...rest } = owed;
    expect(partialRefundCopy(rest)).toBe(
      "Partly refunded: 20,000 sats sent, 50,000 sats still owed. The rest will be refunded when more escrow funds are available.",
    );
  });

  it("nothing when the field is absent, not settled, fully covered, or malformed", () => {
    expect(partialRefundCopy(undefined)).toBeNull();
    expect(partialRefundCopy(null)).toBeNull();
    expect(partialRefundCopy({ ...owed, settled: false })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: 0 })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: -5 })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: "x" as unknown as number })).toBeNull();
    expect(partialRefundCopy({ settled: true, outstanding_sats: 5 })).toBeNull();
    expect(partialRefundHtml(undefined)).toBe("");
  });

  it("escapes and wraps the sentence as a note", () => {
    document.body.innerHTML = partialRefundHtml(owed);
    const el = document.querySelector(".partial-refund-note");
    expect(el?.textContent).toBe(COPY);
    expect(el?.getAttribute("role")).toBe("note");
  });
});

describe("structured funding view", () => {
  const base = { pool_refund_address: "tb1qpool", reserve_sats: 1000, reviewer_reserve_percent: 2 };

  it("shows the partial refund under the donor pool refund row when present", () => {
    document.body.innerHTML = structuredFundingBodyHtml({ ...base, donate_remainder_owed: owed });
    expect(document.querySelector(".partial-refund-note")?.textContent).toBe(COPY);
  });

  it("is unchanged when the field is absent", () => {
    const without = structuredFundingBodyHtml(base);
    expect(without).not.toContain("partial-refund-note");
    expect(without).not.toContain("Partly refunded");
  });
});
