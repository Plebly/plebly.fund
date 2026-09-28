import { defineConfig } from "vite";

export default defineConfig({
  // Custom domain uses "/"; github.io project pages use "/plebly.fund/"
  base: process.env.VITE_BASE_PATH || "/",
  appType: "spa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/workers-api": {
        // Dual-bind: same signet Worker as api.plebly.fund until DNS exists.
        target:
          process.env.VITE_WORKERS_API || "https://api.signet.plebly.fund",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/workers-api/, "") || "/",
      },
    },
  },
});
