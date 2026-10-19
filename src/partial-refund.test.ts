import { describe, expect, it } from "vitest";
import {
  PARTLY_REFUNDED_LABEL,
  REFUND_OWED_LABEL,
  partialRefundCopy,
  partialRefundHtml,
  refundStatusLabel,
} from "./partial-refund";
import { structuredFundingBodyHtml } from "./proposal-structured-funding";
import { escapeHtml } from "./util";

/** UI UX + Research final copy, pinned literally. */
const PARTLY =
  "Partly refunded: 19,700 sats sent, 50,300 sats still owed. The amount still owed is on record.";
const OWED = "50,300 sats still owed. The amount owed is on record.";
/** Until the pool top-up is live, nothing may promise the remainder will be sent. */
const PROMISE = /rest will be refunded|will be refunded|when more escrow funds|more escrow funds are available|pending/i;

const owed = {
  owed_sats: 70_000,
  covered_sats: 19_700,
  outstanding_sats: 50_300,
  sent_sats: 19_700,
  settled: true,
};
const { sent_sats: _sent, ...noSent } = owed;

/** sent_sats values that mean "nothing known to be sent". */
const NOT_SENT: Array<[string, unknown]> = [
  ["0", 0],
  ["-0", -0],
  ["0.4 (below 1 sat)", 0.4],
  ["-1", -1],
  ["-19,700", -19_700],
  ["null", null],
  ["a string", "19700"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
];

describe("partial refund copy and pill", () => {
  it("label constants are the agreed strings", () => {
    expect(PARTLY_REFUNDED_LABEL).toBe("Partly refunded");
    expect(REFUND_OWED_LABEL).toBe("Refund owed");
  });

  it("sent_sats > 0: Partly refunded line and pill (sent = donor-pool output)", () => {
    expect(partialRefundCopy(owed)).toBe(PARTLY);
    expect(refundStatusLabel("refunded", owed)).toBe("Partly refunded");
  });

  it("1 sat sent is a real figure: Partly refunded", () => {
    expect(partialRefundCopy({ ...owed, sent_sats: 1 })).toBe(
      "Partly refunded: 1 sats sent, 50,300 sats still owed. The amount still owed is on record.",
    );
    expect(refundStatusLabel("refunded", { ...owed, sent_sats: 1 })).toBe("Partly refunded");
  });

  it("missing sent_sats is Refund owed on purpose (before workers#109 it can mean nothing was sent)", () => {
    expect(partialRefundCopy(noSent)).toBe(OWED);
    expect(refundStatusLabel("refunded", noSent)).toBe("Refund owed");
    // Never covered_sats as the sent figure.
    expect(partialRefundCopy({ ...noSent, covered_sats: 12_345 })).toBe(OWED);
    expect(partialRefundCopy(noSent)).not.toContain("sent");
  });

  for (const [name, v] of NOT_SENT) {
    it(`sent_sats ${name}: Refund owed line and pill, never a sent figure`, () => {
      const o = { ...owed, sent_sats: v as number };
      expect(partialRefundCopy(o)).toBe(OWED);
      expect(partialRefundCopy(o)).not.toMatch(/sent/);
      expect(refundStatusLabel("refunded", o)).toBe("Refund owed");
      expect(partialRefundHtml(o)).toBe(partialRefundHtml(noSent));
    });
  }

  it("pill falls back to the server status exactly when no note shows", () => {
    expect(refundStatusLabel("refunded", owed, false)).toBe("refunded");
    expect(refundStatusLabel("refunded", noSent, false)).toBe("refunded");
    expect(refundStatusLabel("refunded", { ...owed, settled: false })).toBe("refunded");
    expect(refundStatusLabel("refunded", { ...owed, outstanding_sats: 0 })).toBe("refunded");
    expect(refundStatusLabel("refunded", undefined)).toBe("refunded");
  });

  it("missing or malformed outstanding_sats hides the note and the pill, with or without sent_sats", () => {
    expect(partialRefundCopy(undefined)).toBeNull();
    expect(partialRefundCopy(null)).toBeNull();
    expect(partialRefundCopy({ ...owed, settled: false })).toBeNull();
    for (const o of [owed, noSent]) {
      const { outstanding_sats: _o, ...noOutstanding } = o;
      for (const bad of [undefined, 0, -5, 0.4, "x", "50300", null, Number.NaN]) {
        const row = bad === undefined ? noOutstanding : { ...o, outstanding_sats: bad as number };
        expect(partialRefundCopy(row)).toBeNull();
        expect(partialRefundHtml(row)).toBe("");
        expect(refundStatusLabel("refunded", row)).toBe("refunded");
      }
    }
    expect(partialRefundHtml(undefined)).toBe("");
  });

  it("no promise wording in either line or label", () => {
    for (const o of [owed, noSent, { ...owed, sent_sats: 0 }, { ...owed, sent_sats: 1 }]) {
      expect(partialRefundCopy(o)).not.toMatch(PROMISE);
      expect(refundStatusLabel("refunded", o)).not.toMatch(PROMISE);
    }
    expect(PARTLY_REFUNDED_LABEL + REFUND_OWED_LABEL).not.toMatch(PROMISE);
  });

  for (const [name, o, copy] of [
    ["Partly refunded", owed, PARTLY],
    ["Refund owed", noSent, OWED],
  ] as const) {
    it(`${name}: escaped and wrapped as a single note`, () => {
      const html = partialRefundHtml(o);
      expect(html).toBe(`<p class="muted partial-refund-note" role="note">${escapeHtml(copy)}</p>`);
      document.body.innerHTML = html;
      const notes = document.querySelectorAll(".partial-refund-note");
      expect(notes).toHaveLength(1);
      expect(notes[0]!.textContent).toBe(copy);
      expect(notes[0]!.getAttribute("role")).toBe("note");
      expect(notes[0]!.children).toHaveLength(0);
    });
  }
});

describe("structured funding view", () => {
  const base = { pool_refund_address: "tb1qpool", reserve_sats: 1000, reviewer_reserve_percent: 2 };

  it("shows the Partly refunded note under the donor pool refund row when sent_sats > 0", () => {
    document.body.innerHTML = structuredFundingBodyHtml({ ...base, donate_remainder_owed: owed });
    expect(document.querySelector(".partial-refund-note")?.textContent).toBe(PARTLY);
  });

  it("shows the owed note when sent_sats is 0 or missing", () => {
    for (const o of [noSent, { ...owed, sent_sats: 0 }]) {
      document.body.innerHTML = structuredFundingBodyHtml({ ...base, donate_remainder_owed: o });
      expect(document.querySelector(".partial-refund-note")?.textContent).toBe(OWED);
      expect(document.body.textContent).not.toMatch(PROMISE);
    }
  });

  it("is unchanged when the field is absent", () => {
    const without = structuredFundingBodyHtml(base);
    expect(without).not.toContain("partial-refund-note");
    expect(without).not.toContain("Partly refunded");
    expect(without).not.toContain("still owed");
  });
});
