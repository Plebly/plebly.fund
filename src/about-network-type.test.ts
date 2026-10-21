import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Generated per build network. If ABOUT_BITCOIN_NETWORK were emitted as a bare
 * literal (`= "mainnet"`), TypeScript would narrow it and `!== "signet"`
 * checks fail to compile on mainnet builds (TS2367). Keep the union type.
 */
describe("generated ABOUT_BITCOIN_NETWORK type", () => {
  it("is declared as the network union, not the build's literal", () => {
    const src = readFileSync(
      join(__dirname, "generated", "about-data.ts"),
      "utf8",
    );
    expect(src).toContain(
      'export type AboutBitcoinNetwork = "signet" | "mainnet";',
    );
    expect(src).toMatch(
      /export const ABOUT_BITCOIN_NETWORK: AboutBitcoinNetwork = "(signet|mainnet)";/,
    );
  });
});
