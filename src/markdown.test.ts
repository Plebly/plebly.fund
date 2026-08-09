import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("autolinks bare https URLs with safe target attrs", () => {
    const html = renderMarkdown("Read https://example.com/docs for context.");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("renders explicit markdown links the same way", () => {
    const html = renderMarkdown("See [the BIP](https://example.com/bip).");
    expect(html).toContain('href="https://example.com/bip"');
    expect(html).toContain(">the BIP</a>");
    expect(html).toContain('target="_blank"');
  });

  it("returns empty for blank input", () => {
    expect(renderMarkdown("   ")).toBe("");
  });

  it("strips script tags (no executable markup)", () => {
    const html = renderMarkdown("<script>alert(1)</script>Hello");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("Hello");
  });

  it("strips img onerror handlers", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/<img[^>]+on\w+=/i);
  });

  it("drops javascript: markdown links", () => {
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("x");
  });

  it("drops raw javascript: anchor tags", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/href\s*=/i);
  });
});
