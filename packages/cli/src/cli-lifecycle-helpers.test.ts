import { describe, expect, it } from "vite-plus/test";
import {
  advanceNextAction,
  commitShaFromAdvanceOptions,
  selectVerificationSignoffEntry,
  shouldCompleteForAdvance,
  shouldRunConfiguredAdvanceStep,
  verificationCommandMissingMessage,
  verificationCommandsForRun,
  verificationRunCommandKey,
  verificationRunStatusFromExecution,
  verificationRunSummary,
  verificationSignoffText,
} from "./lifecycle.js";

describe("lifecycle helpers", () => {
  it("selects declared verification sign-offs strictly", () => {
    const verification = [
      { type: "manual" as const, value: "owner approval" },
      { type: "manual" as const, value: "security approval" },
      { type: "command" as const, value: "just ci" },
    ];
    expect(selectVerificationSignoffEntry([], "manual", undefined, "node-a")).toBeNull();
    expect(selectVerificationSignoffEntry(verification, "command", undefined, "node-a")).toEqual({
      type: "command",
      value: "just ci",
    });
    expect(
      selectVerificationSignoffEntry(verification, "manual", "security approval", "node-a"),
    ).toEqual({ type: "manual", value: "security approval" });
    expect(() => selectVerificationSignoffEntry(verification, "url", undefined, "node-a")).toThrow(
      /no url verification entry/,
    );
    expect(() =>
      selectVerificationSignoffEntry(verification, "manual", undefined, "node-a"),
    ).toThrow(/multiple manual verification entries/);
  });

  it("formats verification evidence and command runs", () => {
    expect(
      verificationSignoffText(
        "manual",
        "reviewed fixture provenance",
        { type: "manual", value: "fixture review" },
        "reports/audit.json",
      ),
    ).toBe(
      [
        "Verification sign-off (manual): reviewed fixture provenance",
        "Value: fixture review",
        "Evidence: reports/audit.json",
      ].join("\n"),
    );
    expect(verificationSignoffText("note", "documented", null, undefined)).toBe(
      "Verification sign-off (note): documented",
    );
    expect(verificationRunCommandKey({ type: "command", value: "just ci" })).toBe("just ci");
    expect(verificationRunCommandKey({ type: "manual", value: "owner" })).toBe("manual:owner");
    expect(verificationRunStatusFromExecution({ exitCode: 0, timedOut: false })).toBe("passed");
    expect(verificationRunStatusFromExecution({ exitCode: 1, timedOut: false })).toBe("failed");
    expect(verificationRunStatusFromExecution({ exitCode: 124, timedOut: true })).toBe("timed_out");
    expect(verificationRunSummary("passed", "just ci")).toBe(
      "verification command passed: just ci",
    );
  });

  it("filters command verification runs and reports missing commands clearly", () => {
    const verification = [
      { type: "manual" as const, value: "owner approval" },
      { type: "command" as const, value: "just check" },
      { type: "command" as const, value: "just ci" },
    ];
    expect(verificationCommandsForRun(verification, undefined)).toEqual(["just check", "just ci"]);
    expect(verificationCommandsForRun(verification, "just ci")).toEqual(["just ci"]);
    expect(verificationCommandsForRun(verification, "missing")).toEqual([]);
    expect(verificationCommandMissingMessage(undefined)).toBe(
      "Node has no command verification entries",
    );
    expect(verificationCommandMissingMessage("just docs")).toBe(
      "No matching command verification: just docs",
    );
  });

  it("decides advance lifecycle steps explicitly", () => {
    expect(shouldCompleteForAdvance("ready")).toBe(true);
    expect(shouldCompleteForAdvance("review")).toBe(false);
    expect(shouldCompleteForAdvance("mergeable")).toBe(false);
    expect(shouldCompleteForAdvance("done")).toBe(false);
    expect(shouldRunConfiguredAdvanceStep({}, "just check", "skip-check")).toBe(true);
    expect(shouldRunConfiguredAdvanceStep({ "skip-check": true }, "just check", "skip-check")).toBe(
      false,
    );
    expect(shouldRunConfiguredAdvanceStep({}, " \n\t ", "skip-ci")).toBe(false);
    expect(commitShaFromAdvanceOptions({ "use-existing-commit": "abc" })).toBe("abc");
    expect(commitShaFromAdvanceOptions({ "already-merged-at": "def" })).toBe("def");
    expect(commitShaFromAdvanceOptions({})).toBeUndefined();
    expect(advanceNextAction("mergeable", false)).toMatch(/Perform the real git\/GitHub merge/);
    expect(advanceNextAction("mergeable", true)).toBeNull();
    expect(advanceNextAction("review", false)).toBeNull();
  });
});
