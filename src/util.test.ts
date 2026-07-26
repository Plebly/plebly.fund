import { describe, expect, it } from "vitest";
import {
  bitcoinUri,
  escapeHtml,
  linkifyText,
  proposalRepoPath,
  proposalSlug,
} from "./util";

describe("bitcoinUri", () => {
  it("omits amount when unset and formats sats as BTC", () => {
    expect(bitcoinUri("tb1qabc")).toBe("bitcoin:tb1qabc");
    expect(bitcoinUri("tb1qabc", 10_000)).toBe("bitcoin:tb1qabc?amount=0.0001");
    expect(bitcoinUri("tb1qabc", 100_000_000)).toBe("bitcoin:tb1qabc?amount=1");
  });
});

describe("escapeHtml", () => {
  it("escapes markup carriers", () => {
    expect(escapeHtml(`<a href="x">&`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;",
    );
  });
});

describe("linkifyText", () => {
  it("turns bare https URLs into safe external links", () => {
    const html = linkifyText("See https://example.com/foo for details.");
    expect(html).toContain(
      '<a href="https://example.com/foo" target="_blank" rel="noreferrer noopener">https://example.com/foo</a>',
    );
    expect(html).toContain(" for details.");
  });

  it("strips trailing punctuation and escapes HTML", () => {
    expect(linkifyText("https://bitcoin.org.")).toBe(
      '<a href="https://bitcoin.org" target="_blank" rel="noreferrer noopener">https://bitcoin.org</a>.',
    );
    expect(linkifyText("<script>https://x.test</script>")).toContain(
      "&lt;script&gt;",
    );
    expect(linkifyText("<script>https://x.test</script>")).not.toContain(
      "<script>",
    );
  });

  it("handles multiple urls and http", () => {
    const html = linkifyText(
      "A http://example.com/a and https://example.com/b path.",
    );
    expect(html).toContain('href="http://example.com/a"');
    expect(html).toContain('href="https://example.com/b"');
  });

  it("leaves non-url text alone", () => {
    expect(linkifyText("no links here")).toBe("no links here");
    expect(linkifyText("ftp://not-supported.example")).toBe(
      "ftp://not-supported.example",
    );
  });
});

describe("proposal path helpers", () => {
  it("round-trips slug and repo path", () => {
    expect(proposalSlug("proposals/listed/foo.md")).toBe("listed/foo");
    expect(proposalRepoPath("listed/foo")).toBe("proposals/listed/foo.md");
  });
});
