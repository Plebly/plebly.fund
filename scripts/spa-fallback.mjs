import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** GitHub Pages serves 404.html for unknown paths; copy index for SPA routes. */
const dist = join(process.cwd(), "dist");
const index = join(dist, "index.html");
const fallback = join(dist, "404.html");

if (!existsSync(index)) {
  console.error("spa-fallback: dist/index.html missing; run vite build first");
  process.exit(1);
}
copyFileSync(index, fallback);
console.log("Wrote dist/404.html for SPA deep links");
