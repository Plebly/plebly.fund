import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** WCAG 2.x relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(resolve(__dirname, "style.css"), "utf8");
const rootStart = css.indexOf(":root");
const root = css.slice(rootStart, css.indexOf("}", rootStart));

function token(name: string): string {
  const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`token --${name} not found as #rrggbb in :root`);
  return m[1];
}

describe("colour contrast (WCAG AA 4.5:1 for normal text)", () => {
  it("computes the known reference ratio", () => {
    // White on Bitcoin orange #f7931a is the 2.29:1 pair from the audit.
    expect(contrastRatio("#ffffff", "#f7931a")).toBeCloseTo(2.29, 1);
  });

  it.each([
    // light label on a coloured button fill (.btn, .btn:hover, nav badge)
    ["accent-on", "accent"],
    ["accent-on", "accent-hover"],
  ])("--%s on --%s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    // coloured text on the page and card backgrounds, incl. the orange token
    ["overfund", "bg"],
    ["overfund", "bg-elevated"],
    ["accent-text", "bg"],
    ["accent-text", "bg-elevated"],
    ["muted", "bg"],
    ["ink-secondary", "bg-elevated"],
  ])("--%s text on --%s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("never puts a light label on an orange fill", () => {
    const orange = /background(-color)?:\s*(var\(--overfund\)|#f0a04a|#f7931a|#e8923a)/i;
    const light = /(^|[\s;{])color:\s*(#fff\b|#ffffff|white|var\(--accent-on\)|var\(--ink\))/i;
    const offenders = css
      .split("}")
      .filter((rule) => orange.test(rule) && light.test(rule));
    expect(offenders).toEqual([]);
  });
});
