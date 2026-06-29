import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  defaultConfig,
  exec,
  formatConfig,
  migrateProject,
  openDatabase,
  parseConfig,
  readConfig,
  run,
  schemaStatusForRoot,
  writeConfig,
} from "./db.js";
import { migrations } from "./schema.js";

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

  it("round-trips policy sections", () => {
    const config = {
      ...defaultConfig,
      exportDefaultOut: "roadmap/spec-dag.json",
      exportCanonicalizeCommand: "just format {out}",
      hooks: {
        ...defaultConfig.hooks,
        preClaim: "just pre-claim",
        postExport: "just post-export {out}",
      },
      checkTimeoutSeconds: 10,
      ciTimeoutSeconds: 20,
      forbiddenPathGlobs: [".env"],
      maskedEnv: ["DATABASE_URL"],
      broadAuditEvery: 4,
      deepAuditEvery: 12,
      policy: {
        ...defaultConfig.policy,
        requireAuditBeforeCi: false,
        requireVerificationBeforeCi: true,
        requireP2P3DispositionBeforeMerge: false,
        requireMergeCommit: true,
      },
      worktree: {
        baseDir: "../worktrees",
        envTemplate: ".env.example",
        envFile: ".env.local",
      },
    };

    expect(parseConfig(formatConfig(config))).toMatchObject({
      exportDefaultOut: "roadmap/spec-dag.json",
      exportCanonicalizeCommand: "just format {out}",
      hooks: expect.objectContaining({
        preClaim: "just pre-claim",
        postExport: "just post-export {out}",
      }),
      checkTimeoutSeconds: 10,
      ciTimeoutSeconds: 20,
      forbiddenPathGlobs: [".env"],
      maskedEnv: ["DATABASE_URL"],
      broadAuditEvery: 4,
      deepAuditEvery: 12,
      policy: expect.objectContaining({
        requireAuditBeforeCi: false,
        requireVerificationBeforeCi: true,
        requireP2P3DispositionBeforeMerge: false,
        requireMergeCommit: true,
      }),
      worktree: expect.objectContaining({
        baseDir: "../worktrees",
        envTemplate: ".env.example",
        envFile: ".env.local",
      }),
    });
  });

  it("rejects unsupported CI provider settings", () => {
    const text = formatConfig(defaultConfig).replace(
      'ci_provider = "none"',
      'ci_provider = "jenkins"',
    );

    expect(() => parseConfig(text)).toThrow(/ci_provider must be none or github/);
  });

  it("rejects unknown section keys", () => {
    expect(() =>
      parseConfig(`${formatConfig(defaultConfig)}\n[hooks]\npre_magic = "no"\n`),
    ).toThrow(/unknown config key: hooks_pre_magic/);
  });

  it("reports malformed config assignment line numbers", () => {
    expect(() => parseConfig(`${formatConfig(defaultConfig)}\ncheck_command =\n`)).toThrow(
      /line \d+ is not a supported key = value assignment/,
    );
  });

  it("uses defaults for optional policy sections when older configs omit them", () => {
    const minimal = `
schema_version = 1
skills_dir = ".qd/skills"
check_command = ""
ci_command = ""
ci_provider = "none"
ci_repo = ""
ci_workflow = ""
ci_auth = "gh-cli"
merge_strategy = "squash"
require_clean_worktree = true
clean_worktree_except = [".qd/"]
require_gate_before_ci = true
require_ci_before_merge = true
`;

    expect(parseConfig(minimal)).toMatchObject({
      checkTimeoutSeconds: 1200,
      ciTimeoutSeconds: 3600,
      forbiddenPathGlobs: [".env", ".env.*", "**/.env", "**/.env.*"],
      maskedEnv: [],
      broadAuditEvery: 3,
      deepAuditEvery: 9,
      policy: defaultConfig.policy,
      worktree: defaultConfig.worktree,
    });
  });

  it("rejects malformed optional arrays and numbers", () => {
    expect(() =>
      parseConfig(`${formatConfig(defaultConfig)}\n[secrets]\nmasked_env = "DATABASE_URL"\n`),
    ).toThrow(/secrets_masked_env must be an array of strings/);
    expect(() =>
      parseConfig(`${formatConfig(defaultConfig)}\n[check]\ntimeout_seconds = "fast"\n`),
    ).toThrow(/check_timeout_seconds must be a number/);
  });

  it("rejects malformed required scalar values", () => {
    expect(() =>
      parseConfig(
        formatConfig(defaultConfig).replace("schema_version = 1", 'schema_version = "1"'),
      ),
    ).toThrow(/schema_version must be a number/);
    expect(() =>
      parseConfig(
        formatConfig(defaultConfig).replace(
          "require_clean_worktree = true",
          'require_clean_worktree = "true"',
        ),
      ),
    ).toThrow(/require_clean_worktree must be true or false/);
    expect(() =>
      parseConfig(
        formatConfig(defaultConfig).replace(
          'clean_worktree_except = [".qd/"]',
          'clean_worktree_except = ".qd/"',
        ),
      ),
    ).toThrow(/clean_worktree_except must be an array of strings/);
    expect(() =>
      parseConfig(
        formatConfig(defaultConfig).replace('skills_dir = ".qd/skills"', 'skills_dir = ""'),
      ),
    ).toThrow(/skills_dir must not be empty/);
    expect(() =>
      parseConfig(
        formatConfig(defaultConfig).replace('skills_dir = ".qd/skills"', 'skills_dir = "   "'),
      ),
    ).toThrow(/skills_dir must not be empty/);
  });

  it("parses quoted strings, trimmed arrays, and escaped config values strictly", () => {
    const text = formatConfig({
      ...defaultConfig,
      skillsDir: '.qd/skills "quoted"',
      cleanWorktreeExcept: [".qd/", "roadmap/spec-dag.json"],
      maskedEnv: ["DATABASE_URL", "API_TOKEN"],
      worktree: {
        baseDir: "../worktrees",
        envTemplate: ".env.example",
        envFile: ".env.local",
      },
    })
      .replace("schema_version = 1", "   schema_version = 1   ")
      .replace('check_command = ""', 'check_command =   ""   ')
      .replace(
        'clean_worktree_except = [".qd/", "roadmap/spec-dag.json"]',
        'clean_worktree_except = [ ".qd/", "", "roadmap/spec-dag.json" ]',
      );

    expect(parseConfig(text)).toMatchObject({
      skillsDir: '.qd/skills "quoted"',
      cleanWorktreeExcept: [".qd/", "roadmap/spec-dag.json"],
      maskedEnv: ["DATABASE_URL", "API_TOKEN"],
      worktree: {
        baseDir: "../worktrees",
        envTemplate: ".env.example",
        envFile: ".env.local",
      },
    });
  });

  it("reads default config when no config file exists and writes config files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-config-"));
    try {
      const config = await readConfig(root);
      expect(config).toEqual(defaultConfig);
      expect(config.requireGateBeforeCi).toBe(true);
      expect(config.requireCiBeforeMerge).toBe(true);
      expect(config.forbiddenPathGlobs).toEqual([".env", ".env.*", "**/.env", "**/.env.*"]);
      expect(config.maskedEnv).toEqual([]);
      await writeConfig(root, {
        ...defaultConfig,
        ciCommand: "just ci",
      });

      expect(await readConfig(root)).toMatchObject({ ciCommand: "just ci" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses merge strategy variants, booleans, comments, and escaped strings", () => {
    const text = formatConfig({
      ...defaultConfig,
      checkCommand: "just check with spaces",
      mergeStrategy: "rebase",
      requireCleanWorktree: false,
      requireGateBeforeCi: false,
      requireCiBeforeMerge: false,
    });

    expect(parseConfig(`${text}\n# trailing comment\n`)).toMatchObject({
      checkCommand: "just check with spaces",
      mergeStrategy: "rebase",
      requireCleanWorktree: false,
      requireGateBeforeCi: false,
      requireCiBeforeMerge: false,
    });
    expect(
      parseConfig(text.replace('merge_strategy = "rebase"', 'merge_strategy = "merge"'))
        .mergeStrategy,
    ).toBe("merge");
  });

  it("wraps config parse failures with the config path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-config-bad-"));
    try {
      const configPath = path.join(root, ".qd", "config.toml");
      await writeConfig(root, defaultConfig);
      await writeFile(configPath, "not toml\n", "utf8");

      await expect(readConfig(root)).rejects.toThrow(/\.qd\/config\.toml: line 1/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports stale DB schemas and migrates them in place", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-stale-schema-"));
    try {
      await mkdir(path.join(root, ".qd"), { recursive: true });
      const db = await openDatabase(root, { skipSchemaCheck: true });
      for (const migration of migrations.slice(0, -1)) {
        for (const statement of migration.statements) await exec(db, statement);
        await run(db, "insert into schema_migrations (id, applied_at) values (?, ?)", [
          migration.id,
          "1970-01-01T00:00:00.000Z",
        ]);
      }

      const before = await schemaStatusForRoot(root);
      expect(before.ok).toBe(false);
      expect(before.missing).toEqual([migrations.at(-1)!.id]);
      await expect(openDatabase(root)).rejects.toThrow(/Run qd migrate/);

      const after = await migrateProject(root);
      expect(after.ok).toBe(true);
      expect(after.missing).toEqual([]);
      await expect(openDatabase(root)).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
