import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "qd", specifier: "./scripts/oxlint-plugin-qd.mjs" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "qd/max-lines-warn": "warn",
      "qd/max-lines-error": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
});
