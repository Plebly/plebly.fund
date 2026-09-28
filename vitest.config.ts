import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    env: {
      // Avoid DNS to live APIs during unit tests.
      VITE_WORKERS_API: "https://api.test",
    },
  },
});
