/** plebly.fund#74 (Review low): an escrow address is only ever a non-blank string. */
import { describe, expect, it } from "vitest";
import { escrowAddressText, isClaimViewDonateAllowed } from "./next-action";
import { onChainPanelHtml } from "./proposal-ui";
import type { Proposal } from "./types";

const ADDR = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
const BAD: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["number", 123],
  ["object", {}],
  ["array", [ADDR]],
  ["boolean", true],
  ["empty", ""],
  ["blank", "  \t"],
];

describe("escrowAddressText", () => {
  it("returns the trimmed string for a real address", () => {
    expect(escrowAddressText(`  ${ADDR} `)).toBe(ADDR);
  });
  for (const [label, v] of BAD) {
    it(`${label} → null`, () => expect(escrowAddressText(v)).toBeNull());
  }
});

describe("isClaimViewDonateAllowed needs a string escrow_address", () => {
  it("string address + accepting_funds:true → allowed", () => {
    expect(isClaimViewDonateAllowed({ accepting_funds: true, escrow_address: ADDR })).toBe(true);
  });
  for (const [label, v] of BAD) {
    it(`${label} → not allowed`, () => {
      expect(
        isClaimViewDonateAllowed({ accepting_funds: true, escrow_address: v as string }),
      ).toBe(false);
    });
  }
});

describe("onChainPanelHtml renders the escrow row only for a string address", () => {
  const base = { id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM", path: "proposals/listed/PLEBLY-KNOTS-SIZE-VALUE-SPAM.md", status: "listed" } as Proposal;
  it("string → row", () => {
    expect(onChainPanelHtml({ ...base, escrow_address: ADDR })).toContain('id="onchain-escrow-row"');
  });
  for (const [label, v] of BAD) {
    it(`${label} → no row`, () => {
      const html = onChainPanelHtml({ ...base, escrow_address: v as string });
      expect(html).not.toContain("onchain-escrow-row");
      expect(html).not.toContain("[object Object]");
    });
  }
});
