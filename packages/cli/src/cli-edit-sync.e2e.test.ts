import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  configureStrictDoctorCommands,
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd CLI edit and sync surfaces", () => {
  it("edits structured blocker metadata from flags and JSON patches", async () => {
    await qd("setup", "--no-hooks");
    await qd(
      "node",
      "add",
      "--id",
      "hardening-retire-bootstrap-lan-ssh",
      "--title",
      "Retire bootstrap LAN SSH",
      "--spec",
      "Disable the temporary LAN SSH access path.",
      "--acceptance",
      "The bootstrap access path is retired safely.",
    );

    const direct = await qdJson(
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--blocked-by",
      "manual",
      "--blocked-reason",
      "Physical-presence-only SSH/firewall/networking no-go; requires owner console and recovery plan.",
      "--json",
    );
    expect(direct.status).toBe("blocked");
    expect(direct.blocked_by).toBe("manual");
    expect(direct.blocked_reason).toContain("Physical-presence-only");

    await qd(
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--clear-blocker",
      "--status",
      "ready",
    );
    await writeFile(
      path.join(root, "patch.json"),
      `${JSON.stringify({
        blocked_by: "external",
        blocked_reason: "Waiting for the upstream maintenance window.",
        blocked_owner: "ops",
      })}\n`,
      "utf8",
    );

    const patched = await qdJson(
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--from-json",
      "patch.json",
      "--json",
    );
    expect(patched.status).toBe("blocked");
    expect(patched.blocked_by).toBe("external");
    expect(patched.blocked_reason).toBe("Waiting for the upstream maintenance window.");
    expect(patched.blocked_owner).toBe("ops");

    await expectQdFailure(
      /--blocked-reason is required when --blocked-by is set/,
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--blocked-by",
      "manual",
      "--json",
    );
    await writeFile(
      path.join(root, "bad-blocker-patch.json"),
      `${JSON.stringify({
        blocked_by: "manual",
        blocked_reason: null,
      })}\n`,
      "utf8",
    );
    await expectQdFailure(
      /blocked_reason is required when blocked_by is set/,
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--from-json",
      "bad-blocker-patch.json",
      "--json",
    );

    await writeFile(
      path.join(root, "clear-blocker-patch.json"),
      `${JSON.stringify({
        title: "Retired bootstrap LAN SSH",
      })}\n`,
      "utf8",
    );
    const cleared = await qdJson(
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--from-json",
      "clear-blocker-patch.json",
      "--clear-blocker",
      "--status",
      "ready",
      "--json",
    );
    expect(cleared.title).toBe("Retired bootstrap LAN SSH");
    expect(cleared.status).toBe("ready");
    expect(cleared.blocked_by).toBeNull();
    expect(cleared.blocked_reason).toBeNull();

    await qd(
      "node",
      "edit",
      "hardening-retire-bootstrap-lan-ssh",
      "--blocked-by",
      "manual",
      "--blocked-reason",
      "Requires owner console access.",
    );
    await configureStrictDoctorCommands();
    const doctor = await qdJson("doctor", "--strict", "--json");
    expect(doctor.ok).toBe(true);
  });

  it("dry-runs and applies canonical JSON sync without losing blocker metadata", async () => {
    await qd("setup", "--no-hooks");
    await qd(
      "node",
      "add",
      "--id",
      "manual-hardening",
      "--title",
      "Manual hardening",
      "--spec",
      "Prepare a physical-presence hardening change.",
      "--acceptance",
      "The hardening plan is ready for owner action.",
    );
    await qd("export", "--deterministic", "--out", "roadmap/spec-dag.json");

    const exportPath = path.join(root, "roadmap/spec-dag.json");
    const snapshot = JSON.parse(await readFile(exportPath, "utf8")) as {
      nodes: Array<Record<string, unknown>>;
    };
    snapshot.nodes[0] = {
      ...snapshot.nodes[0],
      status: "blocked",
      blocked_by: "manual",
      blocked_reason: "Requires owner console access before proceeding.",
      blocked_owner: "trevor",
    };
    await writeFile(exportPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    const dryRun = await qdJson("sync", "--from", "roadmap/spec-dag.json", "--dry-run", "--json");
    expect(dryRun.ok).toBe(true);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.wouldReplace).toBe(true);
    expect(dryRun.diff.changedNodes).toEqual(["manual-hardening"]);
    expect((await qdJson("node", "show", "manual-hardening", "--json")).status).toBe("ready");

    const brokenSnapshot = JSON.parse(JSON.stringify(snapshot)) as {
      edges: Array<Record<string, unknown>>;
    };
    brokenSnapshot.edges.push({
      from_node: "manual-hardening",
      to_node: "missing-node",
      type: "requires",
      created_at: "1970-01-01T00:00:00.000Z",
    });
    await writeFile(
      path.join(root, "roadmap/broken-spec-dag.json"),
      `${JSON.stringify(brokenSnapshot, null, 2)}\n`,
      "utf8",
    );
    await expectQdFailure(
      /edge references missing to node: missing-node/,
      "sync",
      "--from",
      "roadmap/broken-spec-dag.json",
      "--dry-run",
      "--json",
    );
    await expectQdFailure(
      /edge references missing to node: missing-node/,
      "sync",
      "--from",
      "roadmap/broken-spec-dag.json",
      "--json",
    );
    expect((await qdJson("node", "show", "manual-hardening", "--json")).status).toBe("ready");

    const synced = await qdJson("sync", "--from", "roadmap/spec-dag.json", "--json");
    expect(synced.ok).toBe(true);
    expect(synced.replaced).toBe(true);
    const node = await qdJson("node", "show", "manual-hardening", "--json");
    expect(node.status).toBe("blocked");
    expect(node.blocked_by).toBe("manual");
    expect(node.blocked_reason).toBe("Requires owner console access before proceeding.");
    await configureStrictDoctorCommands();
    expect((await qdJson("doctor", "--strict", "--json")).ok).toBe(true);
  });
});
