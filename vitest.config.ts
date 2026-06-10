import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
    alias: {
      "@aidev/ast": resolve(root, "packages/ast/src/index.ts"),
      "@aidev/core": resolve(root, "packages/core/src/index.ts"),
      "@aidev/history": resolve(root, "packages/history/src/index.ts"),
      "@aidev/render": resolve(root, "packages/render/src/index.ts"),
      "@aidev/llm": resolve(root, "packages/llm/src/index.ts"),
      "@aidev/idea": resolve(root, "packages/idea/src/index.ts"),
      "@aidev/exec": resolve(root, "packages/exec/src/index.ts"),
    },
  },
  test: {
    include: [".devcompanion/tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    fileParallelism: false,
  },
});
