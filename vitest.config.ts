import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
    alias: {
      "@aidev/ast": "/Users/tongtongtot/Desktop/algorithms/ai-dev-companion/packages/ast/src/index.ts",
      "@aidev/core": "/Users/tongtongtot/Desktop/algorithms/ai-dev-companion/packages/core/src/index.ts",
      "@aidev/history": "/Users/tongtongtot/Desktop/algorithms/ai-dev-companion/packages/history/src/index.ts",
      "@aidev/render": "/Users/tongtongtot/Desktop/algorithms/ai-dev-companion/packages/render/src/index.ts",
    },
  },
  test: {
    include: [".devcompanion/tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
});
