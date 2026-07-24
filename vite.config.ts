import { defineConfig } from "vite";

export default defineConfig({
  // Custom domain uses "/"; github.io project pages use "/plebly.fund/"
  base: process.env.VITE_BASE_PATH || "/",
  appType: "spa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
