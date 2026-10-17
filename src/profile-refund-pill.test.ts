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

  it("reads Partly refunded when the partial note shows", () => {
    const out = render({ ...row, donate_remainder_owed: owed });
    expect(out.note).toContain("Partly refunded");
    expect(out.pill).toBe("Partly refunded");
  });

  it("without sent_sats the note shows owed only, and the pill still reads Partly refunded", () => {
    const { sent_sats: _s, ...rest } = owed;
    const out = render({ ...row, donate_remainder_owed: rest });
    expect(out.note).toBe(
      "Partly refunded: 50,300 sats still owed. The rest will be refunded when more escrow funds are available.",
    );
    expect(out.pill).toBe("Partly refunded");
  });

  it("sent_sats 0 renders exactly like a missing sent_sats: owed-only note, no \"0 sats sent\"", () => {
    const { sent_sats: _s, ...rest } = owed;
    const zero = render({ ...row, donate_remainder_owed: { ...owed, sent_sats: 0 } });
    expect(zero).toEqual(render({ ...row, donate_remainder_owed: rest }));
    expect(zero.note).toBe(
      "Partly refunded: 50,300 sats still owed. The rest will be refunded when more escrow funds are available.",
    );
    expect(zero.note).not.toMatch(/sats sent/);
    expect(document.body.textContent).not.toContain("0 sats sent");
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
