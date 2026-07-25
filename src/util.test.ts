import { describe, expect, it } from "vitest";
import { bitcoinUri, escapeHtml, proposalRepoPath, proposalSlug } from "./util";

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

describe("proposal path helpers", () => {
  it("round-trips slug and repo path", () => {
    expect(proposalSlug("proposals/listed/foo.md")).toBe("listed/foo");
    expect(proposalRepoPath("listed/foo")).toBe("proposals/listed/foo.md");
  });
});
