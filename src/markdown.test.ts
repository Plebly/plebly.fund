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
});
