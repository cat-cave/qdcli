import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { addNode, graphSnapshot, restoreGraphSnapshot, setupProject } from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph snapshot reference validation", () => {
  it("rejects invalid runtime references before mutating the local cache", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const snapshot = await graphSnapshot(root);
    const restoredRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-restore-invalid-"));
    try {
      await setupProject(restoredRoot);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          assignments: [
            {
              id: "assignment-1",
              node_id: "missing",
              role: "worker",
              owner: "external:worker",
              branch: null,
              worktree_path: null,
              scope: null,
              status: "open",
              commits_json: "[]",
              evidence_json: "[]",
              summary: null,
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
          ],
        }),
      ).rejects.toThrow(/assignment references missing node/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          assignments: [
            {
              id: "assignment-1",
              node_id: "a",
              role: "worker",
              owner: "external:worker",
              branch: null,
              worktree_path: null,
              scope: null,
              status: "open",
              commits_json: "[]",
              evidence_json: "[]",
              summary: null,
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
            {
              id: "assignment-1",
              node_id: "a",
              role: "auditor",
              owner: "external:auditor",
              branch: null,
              worktree_path: null,
              scope: null,
              status: "open",
              commits_json: "[]",
              evidence_json: "[]",
              summary: null,
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
          ],
        }),
      ).rejects.toThrow(/duplicate assignment id/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          waves: [
            {
              id: "wave-1",
              kind: "implementation",
              status: "open",
              summary: "wave",
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
          ],
          wave_memberships: [
            {
              wave_id: "wave-1",
              node_id: "a",
              assignment_id: "missing",
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/wave membership references missing assignment/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          waves: [
            {
              id: "wave-1",
              kind: "implementation",
              status: "open",
              summary: "wave",
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
            {
              id: "wave-1",
              kind: "audit",
              status: "open",
              summary: "duplicate wave",
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
          ],
        }),
      ).rejects.toThrow(/duplicate wave id/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          wave_memberships: [
            {
              wave_id: "missing",
              node_id: "a",
              assignment_id: null,
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/wave membership references missing wave/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          waves: [
            {
              id: "wave-1",
              kind: "implementation",
              status: "open",
              summary: "wave",
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: null,
            },
          ],
          wave_memberships: [
            {
              wave_id: "wave-1",
              node_id: "missing",
              assignment_id: null,
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/wave membership references missing node/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          runs: [
            {
              id: "run-1",
              node_id: "missing",
              kind: "check",
              status: "passed",
              command: null,
              provider: null,
              exit_code: null,
              git_sha: null,
              external_id: null,
              url: null,
              rationale: null,
              superseded_by: null,
              report_path: null,
              audit_kind: null,
              worktree_path: null,
              agent: null,
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: "2026-06-20T00:00:00.000Z",
              summary: "run",
              log_path: null,
            },
          ],
        }),
      ).rejects.toThrow(/run references missing node/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          runs: [
            {
              id: "run-1",
              node_id: "a",
              kind: "check",
              status: "passed",
              command: null,
              provider: null,
              exit_code: null,
              git_sha: null,
              external_id: null,
              url: null,
              rationale: null,
              superseded_by: null,
              report_path: null,
              audit_kind: null,
              worktree_path: null,
              agent: null,
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: "2026-06-20T00:00:00.000Z",
              summary: "run",
              log_path: null,
            },
            {
              id: "run-1",
              node_id: "a",
              kind: "ci",
              status: "passed",
              command: null,
              provider: null,
              exit_code: null,
              git_sha: null,
              external_id: null,
              url: null,
              rationale: null,
              superseded_by: null,
              report_path: null,
              audit_kind: null,
              worktree_path: null,
              agent: null,
              started_at: "2026-06-20T00:00:00.000Z",
              finished_at: "2026-06-20T00:00:00.000Z",
              summary: "duplicate run",
              log_path: null,
            },
          ],
        }),
      ).rejects.toThrow(/duplicate run id/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          findings: [
            {
              id: "finding-1",
              node_id: "a",
              run_id: "missing",
              severity: "P2",
              status: "open",
              title: "Finding",
              path: null,
              line: null,
              evidence: "evidence",
              expected: null,
              suggested_fix: null,
              created_at: "2026-06-20T00:00:00.000Z",
              resolved_at: null,
            },
          ],
        }),
      ).rejects.toThrow(/finding references missing run/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          findings: [
            {
              id: "finding-1",
              node_id: "missing",
              run_id: null,
              severity: "P2",
              status: "open",
              title: "Finding",
              path: null,
              line: null,
              evidence: "evidence",
              expected: null,
              suggested_fix: null,
              created_at: "2026-06-20T00:00:00.000Z",
              resolved_at: null,
            },
          ],
        }),
      ).rejects.toThrow(/finding references missing node/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          node_notes: [
            {
              id: "note-1",
              node_id: "missing",
              kind: "note",
              text: "note",
              evidence: null,
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/note references missing node/);
      expect((await graphSnapshot(restoredRoot)).nodes).toHaveLength(0);
    } finally {
      await rm(restoredRoot, { recursive: true, force: true });
    }
  });
});
