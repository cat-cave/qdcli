import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "packages/**/*.test.ts",
        "packages/core/src/index.ts",
        "packages/cli/src/prompts.ts",
      ],
      include: ["packages/core/src/**/*.ts", "packages/cli/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        branches: 75,
        functions: 90,
        lines: 88,
        statements: 86,
      },
    },
    environment: "node",
    include: ["packages/**/*.test.ts"],
  },
});
