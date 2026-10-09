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

  // happy-dom does not run DOMPurify faithfully (it drops the first node and
  // passes the rest through), so these only prove the leading-payload case.
  // The sanitizer allowlist is checked in Chromium: e2e/markdown-sanitize.spec.ts.
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

  // Payload after text: under happy-dom only the string fallback
  // (stripUnsafeHrefs) sees it, so this pins that fallback. A value holding
  // the other quote character used to slip through it.
  it("fallback strip removes non-http href/src values that contain a quote", () => {
    const html = renderMarkdown(
      `Text <a href="mailto:o'neil@example.com">mail</a> <a href="javascript:alert('x')">js</a> ` +
        `<img src="data:image/png;base64,AA'A" alt="pic"> <a href='javascript:alert("y")'>js2</a>`,
    );
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:image");
    expect(html).not.toMatch(/\s(href|src)\s*=/i);
    expect(html).toContain("mail");
  });

  it("fallback strip keeps http(s) values that contain a quote", () => {
    const html = renderMarkdown(
      `Text <a href="https://example.com/o'neil">a</a> <img src="https://example.com/a'b.png" alt="pic">`,
    );
    expect(html).toContain(`href="https://example.com/o'neil"`);
    expect(html).toContain(`src="https://example.com/a'b.png"`);
  });
});
