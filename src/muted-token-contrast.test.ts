// --muted is the site-wide secondary text colour (.muted plus ~150 rules in
// style.css). It must clear WCAG AA 4.5:1 on every surface it sits on: the page
// (--bg), cards (--bg-elevated) and hover/raised rows (--bg-hover). The boot
// skeleton in index.html mirrors it as --boot-muted and must stay in sync.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "style.css"), "utf8");
const html = readFileSync(join(here, "..", "index.html"), "utf8");

function rootToken(src: string, name: string): string {
  const m = src.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`token ${name} not found`);
  return m[1].toLowerCase();
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("--muted token contrast (WCAG AA)", () => {
  const muted = rootToken(css, "--muted");

  it("contrast helper matches known values", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    // Previous token: below AA on all three surfaces.
    expect(contrast("#78728a", "#0c0b10")).toBeCloseTo(4.27, 2);
    expect(contrast("#78728a", "#1d1a27")).toBeCloseTo(3.72, 2);
  });

  for (const surface of ["--bg", "--bg-elevated", "--bg-hover"]) {
    it(`clears 4.5:1 on ${surface}`, () => {
      expect(contrast(muted, rootToken(css, surface))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("index.html boot skeleton mirrors --muted and the surface tokens", () => {
    expect(rootToken(html, "--boot-muted")).toBe(muted);
    expect(rootToken(html, "--boot-bg")).toBe(rootToken(css, "--bg"));
    expect(rootToken(html, "--boot-elevated")).toBe(rootToken(css, "--bg-elevated"));
    expect(rootToken(html, "--boot-hover")).toBe(rootToken(css, "--bg-hover"));
  });
});
