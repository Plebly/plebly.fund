#!/usr/bin/env node
/**
 * Type-check the SPA as both a signet and a mainnet build.
 *
 * src/generated/*.ts is emitted per VITE_BITCOIN_NETWORK, so `tsc` on a
 * signet checkout cannot catch code that only fails under mainnet types.
 * For each network: regenerate, then `tsc --noEmit` (tsconfig already has
 * noEmit). Afterwards the generated files are restored for the caller's
 * VITE_BITCOIN_NETWORK (default signet).
 *
 * Usage: node scripts/typecheck-networks.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", ".bin", "tsc");
const original = process.env.VITE_BITCOIN_NETWORK || "signet";

function run(cmd, args, network) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_BITCOIN_NETWORK: network },
  });
  return res.status === 0;
}

const failed = [];
for (const network of ["signet", "mainnet"]) {
  console.log(`typecheck-networks: ${network}`);
  const ok =
    run(process.execPath, ["scripts/build-about.mjs"], network) &&
    run(tsc, ["-p", "tsconfig.json"], network);
  if (!ok) failed.push(network);
}

run(process.execPath, ["scripts/build-about.mjs"], original);

if (failed.length) {
  console.error(`typecheck-networks: FAILED for ${failed.join(", ")}`);
  process.exit(1);
}
console.log("typecheck-networks: signet and mainnet OK");
