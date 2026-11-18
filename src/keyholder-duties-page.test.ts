import { describe, expect, it } from "vitest";
import {
  dutiesBodyMarkdown,
  keyholderDutiesPageHtml,
} from "./keyholder-duties-page";

describe("keyholder duties page", () => {
  it("renders in the site chrome instead of dumping raw markdown", () => {
    const html = keyholderDutiesPageHtml();
    expect(html).toContain("<h1>Keyholder responsibilities</h1>");
    expect(html).toContain("operator can spend the keyholder pool");
    expect(html).toContain("/keyholders");
    expect(html).toContain("/terms");
    expect(html).not.toContain("/docs/keyholder-responsibilities.md");
  });

  it("hides the escrow duties when new listings pay the builder", () => {
    const html = keyholderDutiesPageHtml("# Title\n\noperator can spend the keyholder pool", false);
    expect(html).toContain("Keyholder applications are closed");
    expect(html).not.toContain("operator can spend the keyholder pool");
    expect(html).not.toContain("/keyholders");
  });

  it("drops the source markdown heading so the page h1 is unique", () => {
    expect(dutiesBodyMarkdown("# Title\n\nBody text.")).toBe("Body text.");
  });
});
