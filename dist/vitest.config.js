"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
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
//# sourceMappingURL=vitest.config.js.map