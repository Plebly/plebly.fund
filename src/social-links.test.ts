import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, profileLinkHtml } from "./social-links";

describe("isSafeHttpUrl", () => {
  it("accepts http(s)", () => {
    expect(isSafeHttpUrl("https://github.com/x")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript and other schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,hi")).toBe(false);
  });
});

describe("profileLinkHtml", () => {
  it("does not emit javascript: hrefs", () => {
    const html = profileLinkHtml({
      label: "evil",
      url: "javascript:alert(1)",
    });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("evil");
  });
});
