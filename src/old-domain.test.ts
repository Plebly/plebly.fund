import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("old plebly.bitcoin domain", () => {
  for (const file of ["public/llms-full.txt", "public/llms.txt", "src/profile-pages.ts"]) {
    it(`${file} never names plebly.bitcoin`, () => {
      expect(read(file)).not.toContain("plebly.bitcoin");
    });
  }

  it("llms-full.txt links the live site", () => {
    expect(read("public/llms-full.txt")).toContain("https://plebly.fund/llms.txt");
  });
});
