import { describe, expect, it } from "vitest";
import { funderConcentrationLine } from "./proposal-ui";

describe("funder concentration line", () => {
  it("names a public funder and counts the anonymous bucket", () => {
    expect(
      funderConcentrationLine({
        top_share_bps: 7000,
        unattributed_bps: 1500,
        funder_count: 4,
        top_name: "ada",
      }),
    ).toBe("ada 70% · unattributed 15% · 4 funders");
    expect(
      funderConcentrationLine({
        top_share_bps: 7000,
        unattributed_bps: 1500,
        funder_count: 4,
      }),
    ).toBe("Largest funder 70% · unattributed 15% · 4 funders");
  });
});
