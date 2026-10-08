import { expect, test } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";

/**
 * renderMarkdown's DOMPurify pass, checked in real Chromium.
 *
 * The unit suite runs under happy-dom, where DOMPurify 3.4 does not sanitize:
 * it drops the first node and passes everything after it through unchanged
 * (`Hello <script>…` keeps the <script>). The vitest sanitizer tests put the
 * payload first, so they stay green even if PURIFY_CONFIG allows <script> or
 * onerror. This spec bundles src/markdown.ts as-is and runs it in a browser
 * page, with every payload placed after ordinary text.
 *
 * No network: the page is about:blank plus the bundle.
 */
const entry = fileURLToPath(new URL("../src/markdown.ts", import.meta.url));

let bundle = "";
test.beforeAll(async () => {
  const out = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ["iife"], name: "PleblyMarkdown" },
    },
  });
  const outputs = Array.isArray(out) ? out : [out];
  for (const o of outputs) {
    if ("output" in o) {
      const chunk = o.output.find((c) => c.type === "chunk");
      if (chunk && chunk.type === "chunk") bundle = chunk.code;
    }
  }
  expect(bundle.length).toBeGreaterThan(1000);
});

async function render(
  page: import("@playwright/test").Page,
  md: string,
): Promise<string> {
  return page.evaluate(
    (src) =>
      (
        window as unknown as {
          PleblyMarkdown: { renderMarkdown: (m: string) => string };
        }
      ).PleblyMarkdown.renderMarkdown(src),
    md,
  );
}

test.describe("renderMarkdown sanitizer (Chromium)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: bundle });
  });

  test("keeps ordinary markdown, including a leading h1", async ({ page }) => {
    const html = await render(page, "# Title\n\nSome **bold** text.\n\n## Next");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<h2>Next</h2>");
  });

  test("strips <script> that follows text", async ({ page }) => {
    const html = await render(page, "Hello <script>window.__x = 1</script> there");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("__x");
    expect(html).toContain("Hello");
  });

  test("strips a block-level <script> after a paragraph", async ({ page }) => {
    const html = await render(page, "Intro\n\n<script>window.__x = 1</script>\n");
    expect(html).not.toMatch(/<script/i);
  });

  test("strips inline event handlers on allowed tags", async ({ page }) => {
    const html = await render(
      page,
      'Text <img src="https://example.com/a.png" onerror="window.__x = 1"> and <a href="https://example.com" onclick="x()">link</a>',
    );
    expect(html).not.toMatch(/\son\w+=/i);
    expect(html).toContain('src="https://example.com/a.png"');
  });

  test("drops tags outside the allowlist (iframe, style, svg, form)", async ({ page }) => {
    const html = await render(
      page,
      'Text <iframe src="https://evil.example"></iframe><style>body{}</style><svg onload="x()"></svg><form action="https://evil.example"><input></form>',
    );
    expect(html).not.toMatch(/<(iframe|style|svg|form|input)\b/i);
  });

  test("removes javascript: and data: hrefs/srcs after text", async ({ page }) => {
    const html = await render(
      page,
      'Text <a href="javascript:alert(1)">a</a> <a href="data:text/html,x">b</a> <img src="javascript:alert(1)">',
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
  });

  test("removes non-http href/src whose value contains an apostrophe", async ({ page }) => {
    // The string fallback after DOMPurify only matched values without a quote
    // character inside, so with a lenient URL check these survived. The hook
    // must drop them, and must not mark the <a> as an external link.
    const html = await render(
      page,
      `Text <a href="mailto:o'neil@example.com">mail</a> and <img src="data:image/png;base64,AA'A" alt="pic">`,
    );
    const dom = await page.evaluate((h) => {
      const t = document.createElement("template");
      t.innerHTML = h;
      const a = t.content.querySelector("a");
      const img = t.content.querySelector("img");
      return {
        aAttrs: a ? a.getAttributeNames() : null,
        imgAttrs: img ? img.getAttributeNames() : null,
      };
    }, html);
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("o'neil");
    expect(html).not.toContain("data:image");
    expect(dom.aAttrs).toEqual([]);
    expect(dom.imgAttrs).toEqual(["alt"]);
    expect(html).toContain("mail");
  });

  test("raw http(s) anchors get target=_blank and rel=noreferrer noopener", async ({ page }) => {
    const html = await render(page, 'Text <a href="https://example.com/x">x</a>');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  test("drops attributes outside the allowlist (style, id, data-*)", async ({ page }) => {
    const html = await render(
      page,
      'Text <p style="position:fixed" id="x" data-a="1" class="ok">p</p>',
    );
    expect(html).not.toMatch(/\s(style|id|data-a)=/);
    expect(html).toContain('class="ok"');
  });
});
