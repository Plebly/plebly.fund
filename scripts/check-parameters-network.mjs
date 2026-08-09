/**
 * Fail the build when generated parameters network disagrees with
 * VITE_BITCOIN_NETWORK (wrong claim floor / fee UX).
 * testnet staging shares the signet parameter overlay (same as config.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/generated/parameters.ts"), "utf8");
const m = src.match(/PLEBLY_PARAMETERS_NETWORK\s*=\s*"([^"]+)"/);
if (!m) {
  console.error("Could not parse PLEBLY_PARAMETERS_NETWORK from generated/parameters.ts");
  process.exit(1);
}
const generated = m[1];
const envNet = (process.env.VITE_BITCOIN_NETWORK || "signet").toLowerCase();
const expected =
  envNet === "mainnet" || envNet === "bitcoin" ? "mainnet" : "signet";
if (generated !== expected) {
  console.error(
    `[plebly] parameters network mismatch: generated=${generated} env=${envNet} (expected overlay ${expected})`,
  );
  process.exit(1);
}
