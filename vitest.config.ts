import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
    alias: {
      "@aidev/ast": "./packages/ast/src/index.ts",
      "@aidev/core": "./packages/core/src/index.ts",
      "@aidev/history": "./packages/history/src/index.ts",
      "@aidev/render": "./packages/render/src/index.ts",
    },

  },
  test: {
    include: [".devcompanion/tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    fileParallelism: false,
  },
});
