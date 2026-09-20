import { describe, expect, it } from "vitest";
import { reviewerRulesPageHtml } from "./reviewer-rules-page";

describe("reviewer rules page", () => {
  it("renders in the site chrome instead of linking a markdown filename", () => {
    const html = reviewerRulesPageHtml();
    expect(html).toContain("<h1>Reviewer rules</h1>");
    expect(html).toContain("two-thirds");
    expect(html).toContain("/reviewers");
    expect(html).toContain("BTCDecoded Intelligence");
    expect(html).not.toContain("REVIEWERS.md");
    expect(html).not.toContain("github.com/Plebly/proposals");
  });
});
