import { describe, expect, it } from "vite-plus/test";
import { installCliFixture, qd, qdJson } from "./cli-e2e-fixtures.js";
import { installFakeGh } from "./github-pr-e2e-fixtures.js";

installCliFixture();

describe("qd GitHub empty dashboards", () => {
  it("returns clean output when no nodes are in flight", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh();
      await qd("setup", "--no-hooks");
      await qd("method", "acknowledge", "--agent", "test");
      expect(await qdJson("monitor", "--json")).toEqual({ ok: true, nodes: [] });
      expect(await qdJson("sync-prs", "--json")).toEqual({ ok: true, nodes: [] });
      expect(await qdJson("ready", "--mergeable", "--json")).toEqual([]);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
