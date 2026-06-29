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
  it("routes structured blocker metadata through block and unblock commands", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
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
      "block",
      "hardening-retire-bootstrap-lan-ssh",
      "--type",
      "manual",
      "--reason",
      "Physical-presence-only SSH/firewall/networking no-go; requires owner console and recovery plan.",
      "--owner",
      "trevor",
      "--needed",
      "Create owner console and recovery plan before changing SSH/firewall/networking.",
      "--evidence",
      "reports/bootstrap-lan-ssh-blocker.md",
      "--json",
    );
    expect(direct.node.status).toBe("blocked");
    expect(direct.node.blocked_by).toBe("manual");
    expect(direct.node.blocked_reason).toContain("Physical-presence-only");

    await qdJson(
      "unblock",
      "hardening-retire-bootstrap-lan-ssh",
      "--summary",
      "Owner console and recovery plan are documented.",
      "--evidence",
      "reports/bootstrap-lan-ssh-unblocked.md",
      "--json",
    );
    await writeFile(
      path.join(root, "patch.json"),
      `${JSON.stringify({
        nodeId: "hardening-retire-bootstrap-lan-ssh",
        type: "external-dependency",
        reason: "Waiting for the upstream maintenance window.",
        owner: "ops",
        needed: "Confirm the upstream maintenance window is active.",
        evidence: "reports/upstream-maintenance-window.md",
      })}\n`,
      "utf8",
    );

    const patched = await qdJson(
      "block",
      "hardening-retire-bootstrap-lan-ssh",
      "--from-report",
      "patch.json",
      "--json",
    );
    expect(patched.node.status).toBe("blocked");
    expect(patched.node.blocked_by).toBe("external-dependency");
    expect(patched.node.blocked_reason).toBe("Waiting for the upstream maintenance window.");
    expect(patched.node.blocked_owner).toBe("ops");

    await expectQdFailure(
      /Use qd block or qd unblock/,
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
      /Use qd block or qd unblock/,
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
      "--json",
    );
    expect(cleared.title).toBe("Retired bootstrap LAN SSH");
    expect(cleared.status).toBe("blocked");
    expect(cleared.blocked_by).toBe("external-dependency");

    await qdJson(
      "unblock",
      "hardening-retire-bootstrap-lan-ssh",
      "--summary",
      "Upstream maintenance window is complete.",
      "--evidence",
      "reports/upstream-maintenance-complete.md",
      "--json",
    );
    await qdJson(
      "block",
      "hardening-retire-bootstrap-lan-ssh",
      "--type",
      "manual",
      "--reason",
      "Requires owner console access.",
      "--owner",
      "trevor",
      "--needed",
      "Owner console must be available.",
      "--evidence",
      "reports/owner-console-required.md",
      "--json",
    );
    await configureStrictDoctorCommands();
    const doctor = await qdJson("doctor", "--strict", "--json");
    expect(doctor.ok).toBe(true);
  });

  it("dry-runs and applies canonical JSON sync without losing blocker metadata", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
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
    expect(dryRun.action).toBe("replace-local-cache");
    expect(dryRun.summary).toBe("1 changed node(s)");
    expect(dryRun.diff.changedNodes).toEqual(["manual-hardening"]);
    expect((await qdJson("node", "show", "manual-hardening", "--json")).status).toBe("ready");

    const diffArtifact = await qdJson(
      "sync",
      "--from",
      "roadmap/spec-dag.json",
      "--dry-run",
      "--write-diff",
      "roadmap/sync-diff.json",
      "--json",
    );
    const writtenDiff = JSON.parse(
      await readFile(path.join(root, "roadmap/sync-diff.json"), "utf8"),
    ) as {
      summary: string;
      diff: { changedNodes: string[] };
    };
    expect(diffArtifact.summary).toBe("1 changed node(s)");
    expect(writtenDiff.summary).toBe("1 changed node(s)");
    expect(writtenDiff.diff.changedNodes).toEqual(["manual-hardening"]);
    await expectQdFailure(
      /qd sync --expect-clean found drift: 1 changed node/,
      "sync",
      "--from",
      "roadmap/spec-dag.json",
      "--expect-clean",
      "--json",
    );

    const oldExport = JSON.parse(JSON.stringify(snapshot)) as {
      schema_version: number;
      nodes: Array<Record<string, unknown>>;
    };
    oldExport.schema_version = 1;
    for (const node of oldExport.nodes) {
      delete node.blocked_by;
      delete node.blocked_reason;
      delete node.blocked_owner;
      delete node.check_command;
      delete node.ci_command;
      delete node.verification;
      delete node.audit_focus;
    }
    await writeFile(
      path.join(root, "roadmap/old-spec-dag.json"),
      `${JSON.stringify(oldExport, null, 2)}\n`,
      "utf8",
    );
    const oldDryRun = await qdJson(
      "sync",
      "--from",
      "roadmap/old-spec-dag.json",
      "--dry-run",
      "--json",
    );
    expect(oldDryRun.ok).toBe(true);
    expect(oldDryRun.nodes).toBe(1);

    const invalidDryRunSnapshot = JSON.parse(JSON.stringify(snapshot)) as {
      nodes: Array<Record<string, unknown>>;
    };
    invalidDryRunSnapshot.nodes[0] = {
      ...invalidDryRunSnapshot.nodes[0],
      status: "blocked",
      blocked_by: "manual",
      blocked_reason: null,
    };
    await writeFile(
      path.join(root, "roadmap/invalid-dry-run-spec-dag.json"),
      `${JSON.stringify(invalidDryRunSnapshot, null, 2)}\n`,
      "utf8",
    );
    await expectQdFailure(
      /blocked_reason is required when blocked_by is set/,
      "sync",
      "--from",
      "roadmap/invalid-dry-run-spec-dag.json",
      "--dry-run",
      "--json",
    );

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
    expect(synced.action).toBe("replaced-local-cache");
    const node = await qdJson("node", "show", "manual-hardening", "--json");
    expect(node.status).toBe("blocked");
    expect(node.blocked_by).toBe("manual");
    expect(node.blocked_reason).toBe("Requires owner console access before proceeding.");
    const clean = await qdJson(
      "sync",
      "--from",
      "roadmap/spec-dag.json",
      "--expect-clean",
      "--json",
    );
    expect(clean.ok).toBe(true);
    expect(clean.replaced).toBe(false);
    expect(clean.action).toBe("none");
    expect(clean.summary).toBe("no drift");
    await configureStrictDoctorCommands();
    expect((await qdJson("doctor", "--strict", "--json")).ok).toBe(true);
  });
});
