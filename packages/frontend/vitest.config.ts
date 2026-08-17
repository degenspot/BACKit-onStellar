import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Vitest compiles TSX with esbuild; the app itself keeps using the Next.js
  // compiler, so no extra React plugin is required here.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
