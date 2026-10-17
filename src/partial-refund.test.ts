import { describe, expect, it } from "vitest";
import { partialRefundCopy, partialRefundHtml, refundStatusLabel } from "./partial-refund";
import { structuredFundingBodyHtml } from "./proposal-structured-funding";

const COPY =
  "Partly refunded: 19,700 sats sent, 50,300 sats still owed. The rest will be refunded when more escrow funds are available.";
const owed = {
  owed_sats: 70_000,
  covered_sats: 19_700,
  outstanding_sats: 50_300,
  sent_sats: 19_700,
  settled: true,
};

describe("partial refund copy", () => {
  it("settled with something still owed: the agreed sentence, sent = donor-pool output", () => {
    expect(partialRefundCopy(owed)).toBe(COPY);
  });

  it("without sent_sats: only what is still owed, never covered_sats as sent", () => {
    const { sent_sats: _s, ...rest } = owed;
    const copy = "Partly refunded: 50,300 sats still owed. The rest will be refunded when more escrow funds are available.";
    expect(partialRefundCopy(rest)).toBe(copy);
    expect(partialRefundCopy({ ...rest, covered_sats: 12_345 })).toBe(copy);
    expect(partialRefundCopy({ ...rest, sent_sats: "x" as unknown as number })).toBe(copy);
    expect(partialRefundCopy(rest)).not.toContain("sent");
  });

  it("negative, null or non-number sent_sats: owed-only line, never \"-N sats sent\" or \"0 sats sent\"", () => {
    const { sent_sats: _s, ...rest } = owed;
    const copy = partialRefundCopy(rest);
    for (const bad of [-1, -19_700, null, "19700", Number.NaN, Number.POSITIVE_INFINITY]) {
      const got = partialRefundCopy({ ...rest, sent_sats: bad as unknown as number });
      expect(got).toBe(copy);
      expect(got).not.toMatch(/sats sent/);
    }
  });

  it("sent_sats 0 (or below 1 sat) behaves like a missing value: owed-only line, no \"0 sats sent\"", () => {
    const { sent_sats: _s, ...rest } = owed;
    const copy = partialRefundCopy(rest);
    for (const zero of [0, -0, 0.4]) {
      const got = partialRefundCopy({ ...owed, sent_sats: zero });
      expect(got).toBe(copy);
      expect(got).not.toMatch(/sats sent/);
    }
    expect(partialRefundHtml({ ...owed, sent_sats: 0 })).toBe(partialRefundHtml(rest));
  });

  it("1 sat sent is a real figure and is shown", () => {
    expect(partialRefundCopy({ ...owed, sent_sats: 1 })).toBe(
      "Partly refunded: 1 sats sent, 50,300 sats still owed. The rest will be refunded when more escrow funds are available.",
    );
  });

  it("status pill reads Partly refunded exactly when the note shows", () => {
    expect(refundStatusLabel("refunded", owed)).toBe("Partly refunded");
    expect(refundStatusLabel("refunded", owed, false)).toBe("refunded");
    expect(refundStatusLabel("refunded", { ...owed, settled: false })).toBe("refunded");
    expect(refundStatusLabel("refunded", { ...owed, outstanding_sats: 0 })).toBe("refunded");
    expect(refundStatusLabel("refunded", undefined)).toBe("refunded");
  });

  it("nothing when the field is absent, not settled, fully covered, or malformed", () => {
    expect(partialRefundCopy(undefined)).toBeNull();
    expect(partialRefundCopy(null)).toBeNull();
    expect(partialRefundCopy({ ...owed, settled: false })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: 0 })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: -5 })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: "x" as unknown as number })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: null as unknown as number })).toBeNull();
    expect(partialRefundCopy({ ...owed, outstanding_sats: "50300" as unknown as number })).toBeNull();
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
