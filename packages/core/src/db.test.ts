import { describe, expect, it } from "vite-plus/test";
import { defaultConfig, formatConfig, parseConfig } from "./db.js";

describe("config", () => {
  it("round-trips CI provider settings", () => {
    const config = {
      ...defaultConfig,
      ciProvider: "github" as const,
      ciRepo: "cat-cave/qdcli",
      ciWorkflow: "publish.yml",
      ciAuth: "gh-cli" as const,
    };

    expect(parseConfig(formatConfig(config))).toMatchObject({
      ciProvider: "github",
      ciRepo: "cat-cave/qdcli",
      ciWorkflow: "publish.yml",
      ciAuth: "gh-cli",
    });
  });

  it("rejects unsupported CI provider settings", () => {
    const text = formatConfig(defaultConfig).replace(
      'ci_provider = "none"',
      'ci_provider = "jenkins"',
    );

    expect(() => parseConfig(text)).toThrow(/ci_provider must be none or github/);
  });
});
