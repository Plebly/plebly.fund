import { describe, expect, it } from "vitest";
import {
  bitcoinUri,
  escapeHtml,
  formatTimeAgo,
  formatTimeAhead,
  linkifyText,
  proposalRepoPath,
  proposalSlug,
  proposalStablePath,
  timeAgoHtml,
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

  it("emits lowercase stable proposal URLs", () => {
    expect(proposalStablePath("PLEBLY-42")).toBe("/p/plebly-42");
    expect(proposalStablePath("  Mixed-Case-Id  ")).toBe("/p/mixed-case-id");
  });
});

describe("formatTimeAgo", () => {
  const now = Date.parse("2026-07-26T17:00:00.000Z");

  it("returns relative labels with absolute title", () => {
    expect(formatTimeAgo("2026-07-26T16:59:30.000Z", now)?.text).toBe(
      "just now",
    );
    expect(formatTimeAgo("2026-07-26T16:40:00.000Z", now)?.text).toBe("20m ago");
    expect(formatTimeAgo("2026-07-26T14:00:00.000Z", now)?.text).toBe("3h ago");
    expect(formatTimeAgo("2026-07-24T17:00:00.000Z", now)?.text).toBe("2d ago");
    const ago = formatTimeAgo("2026-07-26T16:40:00.000Z", now);
    expect(ago?.title).toMatch(/2026/);
  });

  it("renders time element markup", () => {
    const html = timeAgoHtml("2026-07-26T16:40:00.000Z", now);
    expect(html).toContain("<time");
    expect(html).toContain('datetime="2026-07-26T16:40:00.000Z"');
    expect(html).toContain("title=");
    expect(html).toContain("20m ago");
  });
});

describe("formatTimeAhead", () => {
  const now = Date.parse("2026-07-26T17:00:00.000Z");

  it("labels future horizons in days, weeks, and months", () => {
    expect(formatTimeAhead("2026-07-29T17:00:00.000Z", now)?.text).toBe(
      "in 3 days",
    );
    expect(formatTimeAhead("2026-08-09T17:00:00.000Z", now)?.text).toBe(
      "in 2 weeks",
    );
    expect(formatTimeAhead("2027-01-26T17:00:00.000Z", now)?.text).toBe(
      "in 6 months",
    );
  });

  it("labels past deadlines as overdue", () => {
    expect(formatTimeAhead("2026-06-26T17:00:00.000Z", now)?.text).toBe(
      "1 month overdue",
    );
  });
});
