import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vite-plus/test";
import { finishRun, setupProject, startRun } from "./index.js";

export let root = "";

export function installGraphFixture(): void {
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "qdcli-"));
    await setupProject(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
}

export async function passAudit(nodeId: string): Promise<void> {
  const audit = await startRun(root, nodeId, "audit", { auditKind: "acceptance" });
  await finishRun(root, audit.id, { status: "passed", summary: "audit passed" });
}
