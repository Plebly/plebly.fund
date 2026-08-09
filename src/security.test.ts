/**
 * Frontend security suite — XSS sinks, lightning invoice binding, fee-pay notes.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";
import { isSafeHttpUrl, profileLinkHtml } from "./social-links";
import { assertLightningSwapMatches, bolt11AmountSats } from "./bolt11-amount";
import { feePayHtml } from "./fee-pay";
import { assertParametersNetwork } from "./config";
import { linkifyText } from "./util";

describe("security — markdown XSS matrix", () => {
  const cases: { name: string; md: string; forbid: RegExp[] }[] = [
    {
      name: "script tag",
      md: '<script>alert(1)</script>ok',
      forbid: [/<script/i],
    },
    {
      name: "img onerror",
      md: '<img src=x onerror="alert(1)">',
      forbid: [/onerror/i],
    },
    {
      name: "svg onload",
      md: '<svg onload=alert(1)>',
      forbid: [/onload/i, /<svg/i],
    },
    {
      name: "javascript markdown link",
      md: "[click](javascript:alert(1))",
      forbid: [/javascript:/i],
    },
    {
      name: "data URI link",
      md: '[x](data:text/html,<script>alert(1)</script>)',
      forbid: [/data:/i],
    },
    {
      name: "raw javascript anchor",
      md: '<a href="javascript:alert(1)">x</a>',
      forbid: [/javascript:/i],
    },
    {
      name: "iframe",
      md: '<iframe src="https://evil.test"></iframe>',
      forbid: [/<iframe/i],
    },
  ];

  for (const c of cases) {
    it(`neutralizes ${c.name}`, () => {
      const html = renderMarkdown(c.md);
      for (const re of c.forbid) {
        expect(html).not.toMatch(re);
      }
    });
  }

  it("keeps safe https links with noopener", () => {
    const html = renderMarkdown("[ok](https://example.com/a)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });
});

describe("security — profile / linkify sinks", () => {
  it("blocks javascript: profile hrefs", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    const html = profileLinkHtml({
      label: "<img onerror=alert(1)>",
      url: "javascript:alert(1)",
    });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("linkifyText does not create javascript: links", () => {
    const html = linkifyText("see javascript:alert(1) please");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)");
  });
});

describe("security — lightning invoice binding", () => {
  it("decodes and enforces amount + escrow", () => {
    expect(bolt11AmountSats("lnbc2500u1abc")).toBe(250_000);
    expect(() =>
      assertLightningSwapMatches(
        {
          bolt11: "lnbc1000u1xyz",
          invoice_amount_sats: 50_000,
          escrow_address: "bc1qabc",
        },
        { amount_sats: 100_000, escrow_address: "bc1qabc" },
        "mainnet",
      ),
    ).toThrow(/amount mismatch/);
  });
});

describe("security — feePayHtml note escaping", () => {
  it("escapes HTML in note", () => {
    const html = feePayHtml({
      id: "fee",
      amountSats: 10_000,
      address: "tb1qfeeaddressxxxxxxxxxxxxxxxxxxxxxxx",
      note: '<img src=x onerror=alert(1)>',
    });
    const note = html.match(/class="fee-pay-note"[^>]*>([\s\S]*?)<\/p>/)?.[1] || "";
    // Escaped text may still contain the word "onerror"; tags must not parse as HTML.
    expect(note).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(note).not.toMatch(/<img\b/i);
  });
});

describe("security — parameters network assert", () => {
  it("throws on generated/env mismatch", () => {
    expect(() => assertParametersNetwork("mainnet", "signet", 10_000)).toThrow(
      /mismatch/,
    );
  });
});
