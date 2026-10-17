import { beforeAll, describe, expect, it } from "vitest";
import { contributionRefundRowHtml } from "./profile-pages";

const owed = {
  owed_sats: 70_000,
  sent_sats: 19_700,
  covered_sats: 19_700,
  outstanding_sats: 50_300,
  settled: true,
};
const row = {
  proposal_id: "PLEBLY-2026-003",
  amount_sats: 70_000,
  status: "refunded",
  refund_txid: "77".repeat(32),
};

function render(r: Parameters<typeof contributionRefundRowHtml>[0]) {
  document.body.innerHTML = `<ul>${contributionRefundRowHtml(r)}</ul>`;
  return {
    pill: document.querySelector(".pill")?.textContent,
    note: document.querySelector(".partial-refund-note")?.textContent ?? null,
  };
}

describe("account refunds row status pill", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: "https://plebly.bitcoin", pathname: "/account", search: "", hash: "" },
    });
  });

  const PARTLY =
    "Partly refunded: 19,700 sats sent, 50,300 sats still owed. The amount still owed is on record.";
  const OWED = "50,300 sats still owed. The amount owed is on record.";
  const PROMISE = /will be refunded|more escrow funds|pending/i;
  const { sent_sats: _s, ...noSent } = owed;

  it("sent_sats > 0: Partly refunded pill and line", () => {
    const out = render({ ...row, donate_remainder_owed: owed });
    expect(out).toEqual({ pill: "Partly refunded", note: PARTLY });
  });

  it("1 sat sent: Partly refunded", () => {
    const out = render({ ...row, donate_remainder_owed: { ...owed, sent_sats: 1 } });
    expect(out.pill).toBe("Partly refunded");
    expect(out.note).toContain("1 sats sent");
  });

  it("missing sent_sats: Refund owed pill and the owed line (on purpose)", () => {
    expect(render({ ...row, donate_remainder_owed: noSent })).toEqual({
      pill: "Refund owed",
      note: OWED,
    });
  });

  for (const v of [0, -1, null, "19700", Number.NaN]) {
    it(`sent_sats ${String(v)}: renders exactly like missing (Refund owed, no sent figure)`, () => {
      const out = render({ ...row, donate_remainder_owed: { ...owed, sent_sats: v as number } });
      expect(out).toEqual({ pill: "Refund owed", note: OWED });
      expect(document.body.textContent).not.toContain("sats sent");
    });
  }

  it("no promise wording on the row, either case", () => {
    for (const o of [owed, noSent]) {
      render({ ...row, donate_remainder_owed: o });
      expect(document.body.textContent).not.toMatch(PROMISE);
    }
  });

  it("missing outstanding_sats hides the note and the pill, with or without sent_sats", () => {
    for (const o of [owed, noSent]) {
      const { outstanding_sats: _o, ...noOutstanding } = o;
      expect(render({ ...row, donate_remainder_owed: noOutstanding })).toEqual({
        pill: "refunded",
        note: null,
      });
    }
  });

  it("server status in the pill is escaped when no note shows", () => {
    render({ ...row, status: "<img src=x>" });
    expect(document.querySelector(".pill")?.textContent).toBe("<img src=x>");
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps the server status when no partial note shows", () => {
    expect(render(row)).toEqual({ pill: "refunded", note: null });
    expect(render({ ...row, donate_remainder_owed: { ...owed, outstanding_sats: 0 } })).toEqual({
      pill: "refunded",
      note: null,
    });
    // Not paid yet: no note, so no Partly refunded pill either.
    const { refund_txid: _t, ...unpaid } = row;
    expect(render({ ...unpaid, status: "refunding", donate_remainder_owed: owed })).toEqual({
      pill: "refunding",
      note: null,
    });
  });
});
