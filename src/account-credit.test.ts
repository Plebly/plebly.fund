import { beforeAll, describe, expect, it } from "vitest";
import { creditPreferenceFieldsHtml } from "./funder-credit";

/**
 * Account page embeds the shared credit preference fields.
 * Full renderAccount needs network; this locks the markup contract used there.
 */
describe("account funder appearance markup", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        origin: "https://plebly.fund",
        pathname: "/account",
        search: "",
        hash: "",
      },
    });
  });

  it("uses a distinct id prefix from the donate wizard", () => {
    const html = creditPreferenceFieldsHtml({ idPrefix: "account-credit" });
    expect(html).toContain('id="account-credit-public"');
    expect(html).toContain('id="account-credit-amount"');
    expect(html).toContain("Show my identity on the funder list");
    expect(html).toContain("Also show my amount");
    expect(html).not.toContain("donate-credit-public");
  });
});
