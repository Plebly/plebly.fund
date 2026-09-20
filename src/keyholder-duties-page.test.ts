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

  it("drops the source markdown heading so the page h1 is unique", () => {
    expect(dutiesBodyMarkdown("# Title\n\nBody text.")).toBe("Body text.");
  });
});
