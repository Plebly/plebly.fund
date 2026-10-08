import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Bundle guard: the account / public-profile pages load on demand, so
 * profile-pages.ts must not be reachable from main.ts through STATIC imports
 * (type-only imports are erased and don't count). A static import anywhere on
 * the entry graph would silently pull it back into the entry chunk.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));

function staticImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*import\s+(?!type\b)([^;]*?)\s*from\s*["'](\.[^"']+)["']|^\s*import\s*["'](\.[^"']+)["']/gm;
  for (const m of text.matchAll(re)) {
    const spec = m[2] ?? m[3];
    if (!spec) continue;
    // `import { type A, type B } from` is type-only too.
    if (m[1] && /^\{[^}]*\}$/.test(m[1].trim())) {
      const names = m[1].trim().slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith("type "))) continue;
    }
    for (const ext of [".ts", "/index.ts", ""]) {
      const p = resolve(dirname(file), spec + ext);
      if (existsSync(p) && p.endsWith(".ts")) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

function entryGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...staticImports(f));
  }
  return seen;
}

describe("lazy profile pages", () => {
  const main = join(srcDir, "main.ts");
  const profile = join(srcDir, "profile-pages.ts");

  it("profile-pages.ts is not on main.ts's static import graph", () => {
    const graph = entryGraph(main);
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.has(join(srcDir, "router.ts"))).toBe(true);
    expect(graph.has(profile)).toBe(false);
  });

  it("main.ts dynamically imports it for both the account and public-profile routes", () => {
    const text = readFileSync(main, "utf8");
    expect(text).toMatch(/const \{ renderAccount \} = await import\("\.\/profile-pages"\)/);
    expect(text).toMatch(/const \{ renderPublicProfile \} = await import\("\.\/profile-pages"\)/);
  });
});
