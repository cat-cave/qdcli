import { describe, expect, it } from "vite-plus/test";
import { installCliFixture, qd, qdJson } from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd focused help and node schemas", () => {
  it("prints focused help for the reported mutation commands", async () => {
    const unblock = await qd("unblock", "--help");
    expect(unblock).toContain("qd unblock <node>");
    expect(unblock).toContain("--summary");
    expect(unblock).toContain("--evidence");
    expect(unblock).not.toContain("Core:");

    const edit = await qd("node", "edit", "--help");
    expect(edit).toContain("qd node edit <node>");
    expect(edit).toContain("--from-json <patch.json>");
    expect(edit).toContain("qd schema print node-patch");
    expect(edit).not.toContain("Core:");

    const cancel = await qd("node", "cancel", "--help");
    expect(cancel).toContain("qd node cancel <node>");
    expect(cancel).toContain("without deleting its history");
    expect(cancel).not.toContain("Core:");

    const bulk = await qd("nodes", "add-bulk", "--help");
    expect(bulk).toContain("added/skipped-existing");
    expect(bulk).toContain("differing fields");
    expect(bulk).not.toContain("Core:");
  });

  it("publishes copyable node creation and patch schemas", async () => {
    await qd("setup", "--no-hooks");
    expect(await qdJson("schema", "list", "--json")).toEqual(
      expect.arrayContaining(["node", "node-patch"]),
    );

    const nodeSchema = await qdJson("schema", "print", "node");
    expect(nodeSchema).toMatchObject({
      type: "object",
      required: ["title", "spec", "acceptance"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        status: { enum: expect.arrayContaining(["ready", "queued", "done"]) },
        verification: { type: "array" },
      },
    });
    expect(await qdJson("schema", "example", "node")).toMatchObject({
      id: "provider-smoke",
      title: expect.any(String),
      spec: expect.any(String),
      acceptance: expect.any(String),
    });

    const patchSchema = await qdJson("schema", "print", "node-patch");
    expect(patchSchema).toMatchObject({
      type: "object",
      minProperties: 1,
      properties: { branch: { type: ["string", "null"] } },
    });
    expect(patchSchema.properties).not.toHaveProperty("id");
    expect(await qdJson("schema", "example", "node-patch")).toMatchObject({
      priority: "P1",
      spec: expect.any(String),
    });
  });
});
