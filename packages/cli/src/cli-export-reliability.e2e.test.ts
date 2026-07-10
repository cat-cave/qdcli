import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { installCliFixture, qd, qdJson, root } from "./cli-e2e-fixtures.js";
import { setupAcknowledgedProject, writeNodeInput } from "./cli-reconcile-fixtures.js";

installCliFixture();

describe("qd export reliability", () => {
  it("writes the default deterministic export and requires an explicit stdout target", async () => {
    await setupAcknowledgedProject();
    await writeNodeInput("exported", []);
    await qd("node", "add", "--from-json", "exported-node.json");
    expect(await qdJson("ready", "--fields", "id,status", "--json")).toEqual([
      { id: "exported", status: "ready" },
    ]);
    expect(await qdJson("node", "show", "exported", "--fields", "id,title", "--json")).toEqual({
      id: "exported",
      title: "exported node",
    });
    expect(await qdJson("status", "--fields", "nodes,ready", "--json")).toMatchObject({
      nodes: 1,
      ready: 1,
    });
    const result = await qdJson("export", "--deterministic", "--json");
    expect(result.path).toBe("roadmap/spec-dag.json");
    await stat(path.join(root, "roadmap/spec-dag.json"));
    const saved = JSON.parse(await readFile(path.join(root, "roadmap/spec-dag.json"), "utf8"));
    expect(saved.exported_at).toBe("1970-01-01T00:00:00.000Z");
    const streamed = await qdJson("export", "--deterministic", "--out", "-", "--json");
    expect(streamed.nodes.map((node: any) => node.id)).toEqual(["exported"]);
  });
});
