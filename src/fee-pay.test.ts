import { describe, expect, it } from "vitest";
import { feePayHtml } from "./fee-pay";

describe("feePayHtml", () => {
  it("embeds exact amount and address in BIP21 wallet link", () => {
    const html = feePayHtml({
      id: "propose-fee",
      amountSats: 10_000,
      address: "tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(html).toContain("tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx");
    expect(html).toContain("bitcoin:tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx?amount=0.0001");
    expect(html).toContain("10,000 sats");
    expect(html).toContain('data-amount="10000"');
  });

  it("shows fallback copy when address missing", () => {
    const html = feePayHtml({
      id: "claim-bond",
      amountSats: 10_000,
      address: null,
    });
    expect(html).toContain("Fee address is not available from the API yet");
    expect(html).not.toContain("bitcoin:");
  });
});
