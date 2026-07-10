import type { PolicyViolation } from "@cat-cave/qdcli-core";
import { describe, expect, it } from "vite-plus/test";
import { doctorNextActions, nodeDoctorReasons, type NodeDoctorReason } from "./node-doctor.js";

describe("node doctor explanations", () => {
  it("deduplicates gate and phase-specific policy reasons by stable code", () => {
    const gate = [
      { code: "blockingFinding", message: "gate finding", evidence: { id: "f1" } },
      { code: "runningAudit", message: "audit running" },
    ];
    const ci = [
      {
        code: "auditRequired",
        message: "audit needed",
        node_id: "node-a",
        phase: "ci",
        evidence: { kind: "audit" },
      },
      {
        code: "verificationRequired",
        message: "verification needed",
        node_id: "node-a",
        phase: "ci",
      },
    ] satisfies PolicyViolation[];
    const merge = [
      { code: "ciRequired", message: "CI needed", node_id: "node-a", phase: "merge" },
    ] satisfies PolicyViolation[];
    expect([...nodeDoctorReasons("review", gate, ci, merge).values()]).toEqual([
      { code: "blockingFinding", message: "gate finding", evidence: { id: "f1" } },
      { code: "runningAudit", message: "audit running" },
      { code: "auditRequired", message: "audit needed", evidence: { kind: "audit" } },
      { code: "verificationRequired", message: "verification needed", evidence: undefined },
    ]);
    expect([...nodeDoctorReasons("mergeable", [], ci, merge).values()]).toEqual([
      { code: "ciRequired", message: "CI needed", evidence: undefined },
    ]);
    expect([...nodeDoctorReasons("done", [], ci, merge).values()]).toEqual([
      { code: "ciRequired", message: "CI needed", evidence: undefined },
    ]);
  });

  it("explains completion and cancellation states precisely", () => {
    for (const status of ["draft", "ready", "claimed", "working", "fixing", "ci", "regressed"]) {
      expect([...nodeDoctorReasons(status, [], [], []).values()]).toEqual([
        {
          code: "completionRequired",
          message: `Node status ${status} has not recorded evidence-backed completion.`,
        },
      ]);
    }
    expect([...nodeDoctorReasons("blocked", [], [], []).values()]).toEqual([]);
    expect([...nodeDoctorReasons("review", [], [], []).values()]).toEqual([]);
    expect([...nodeDoctorReasons("cancelled", [], [], []).values()]).toEqual([
      { code: "nodeCancelled", message: "The node is cancelled and cannot advance." },
    ]);
  });

  it("prints exact next commands for every actionable reason", () => {
    const reasons: NodeDoctorReason[] = [
      { code: "completionRequired", message: "completion" },
      { code: "auditRequired", message: "audit" },
      { code: "verificationRequired", message: "first", verificationIndex: 1 },
      { code: "verificationRequired", message: "missing index" },
      { code: "verificationRequired", message: "second", verificationIndex: 2 },
      { code: "ciRequired", message: "ci" },
      { code: "followupDispositionRequired", message: "disposition" },
      { code: "staleBase", message: "stale" },
      { code: "blockingFinding", message: "finding" },
      { code: "runningAudit", message: "running" },
      { code: "mergeRecordRequired", message: "merge" },
    ];
    expect(doctorNextActions("node-a", "mergeable", reasons, true)).toEqual([
      "qd complete node-a --from-report <completion-report.json>",
      "qd audit start node-a",
      "qd audit pass node-a --from-report <audit-report.json>",
      "qd verification sign-off node-a --index 1 --note <what-was-checked> --evidence <path-or-url>",
      "qd verification sign-off node-a --index 2 --note <what-was-checked> --evidence <path-or-url>",
      "qd ci run node-a",
      "qd finding list --node node-a --open",
      "qd sync-prs --rebase",
      "qd merge node-a --via-pr",
    ]);
    expect(doctorNextActions("node-a", "mergeable", reasons, false)).toContain(
      "qd merge node-a --use-existing-commit <sha>",
    );
  });

  it("does not suggest merge or unrelated commands outside their applicable state", () => {
    expect(
      doctorNextActions(
        "node-a",
        "review",
        [{ code: "mergeRecordRequired", message: "merge" }],
        true,
      ),
    ).toEqual([]);
    expect(doctorNextActions("node-a", "done", [], true)).toEqual([]);
  });

  it("keeps individually actionable finding, audit, and incomplete verification reasons", () => {
    expect(
      doctorNextActions(
        "node-a",
        "review",
        [{ code: "blockingFinding", message: "finding" }],
        false,
      ),
    ).toEqual(["qd finding list --node node-a --open"]);
    expect(
      doctorNextActions("node-a", "review", [{ code: "runningAudit", message: "running" }], false),
    ).toEqual(["qd audit pass node-a --from-report <audit-report.json>"]);
    expect(
      doctorNextActions(
        "node-a",
        "review",
        [{ code: "verificationRequired", message: "missing index" }],
        false,
      ),
    ).toEqual([]);
  });
});
