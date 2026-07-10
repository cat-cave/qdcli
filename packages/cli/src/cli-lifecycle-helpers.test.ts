import { describe, expect, it } from "vite-plus/test";
import {
  advanceNextAction,
  commitShaFromAdvanceOptions,
  shouldCompleteForAdvance,
  shouldRunConfiguredAdvanceStep,
} from "./lifecycle.js";
import {
  assertCompleteVerificationCoverage,
  selectVerificationSignoffEntry,
  selectVerificationSignoffEntryByIndex,
  verificationCommandMissingMessage,
  verificationCommandsForRun,
  verificationRunCommandKey,
  verificationRunStatusFromExecution,
  verificationRunSummary,
  verificationSignoffText,
} from "./verification.js";

describe("lifecycle helpers", () => {
  it("selects declared verification sign-offs strictly", () => {
    const verification = [
      { type: "manual" as const, value: "owner approval" },
      { type: "manual" as const, value: "security approval" },
      { type: "command" as const, value: "just ci" },
    ];
    expect(() => selectVerificationSignoffEntry([], "manual", undefined, "node-a")).toThrow(
      /no declared verification entries/,
    );
    expect(selectVerificationSignoffEntry(verification, "command", undefined, "node-a")).toEqual({
      type: "command",
      value: "just ci",
    });
    expect(() =>
      selectVerificationSignoffEntry(verification, "command", "just check", "node-a"),
    ).toThrow(/no command verification entry matching/);
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

  it("selects 1-based verification indexes with precise range errors", () => {
    const verification = [
      { type: "command" as const, value: "just ci" },
      { type: "manual" as const, value: "owner approval" },
    ];
    expect(selectVerificationSignoffEntryByIndex(verification, "1", "node-a")).toEqual(
      verification[0],
    );
    expect(selectVerificationSignoffEntryByIndex(verification, "2", "node-a")).toEqual(
      verification[1],
    );
    for (const index of ["0", "-1", "1.5", "wat", true, []] as Array<string | string[] | boolean>) {
      expect(() => selectVerificationSignoffEntryByIndex(verification, index, "node-a")).toThrow(
        index === true || (Array.isArray(index) && index.length === 0)
          ? "--index is required"
          : "--index must be a positive integer",
      );
    }
    expect(() => selectVerificationSignoffEntryByIndex([], "1", "node-a")).toThrow(
      "has 0 declared verification entries; index 1 is out of range",
    );
    expect(() => selectVerificationSignoffEntryByIndex([verification[0]!], "2", "node-a")).toThrow(
      "has 1 declared verification entry; index 2 is out of range",
    );
    expect(() => selectVerificationSignoffEntryByIndex(verification, "3", "node-a")).toThrow(
      "has 2 declared verification entries; index 3 is out of range",
    );
  });

  it("requires one exact, unique report entry for every declared verification", () => {
    const verification = [
      { type: "command" as const, value: "just ci" },
      { type: "manual" as const, value: "owner approval" },
    ];
    const entries = [
      { index: 1, type: "command", value: "just ci" },
      { index: 2, type: "manual", value: "owner approval" },
    ];
    expect(() => assertCompleteVerificationCoverage(verification, entries, "node-a")).not.toThrow();
    expect(() =>
      assertCompleteVerificationCoverage(verification, entries.slice(0, 1), "node-a"),
    ).toThrow("must cover all 2 declared entries; received 1");
    expect(() =>
      assertCompleteVerificationCoverage(verification, [entries[0]!, entries[0]!], "node-a"),
    ).toThrow("Duplicate verification index 1");
    expect(() =>
      assertCompleteVerificationCoverage(
        verification,
        [entries[0]!, { index: 3, type: "manual", value: "owner approval" }],
        "node-a",
      ),
    ).toThrow("verification index 3 is out of range");
    expect(() =>
      assertCompleteVerificationCoverage(
        verification,
        [{ index: 1, type: "manual", value: "just ci" }, entries[1]!],
        "node-a",
      ),
    ).toThrow('does not exactly match the declared command verification "just ci"');
    expect(() =>
      assertCompleteVerificationCoverage(
        verification,
        [{ index: 1, type: "command", value: "just test" }, entries[1]!],
        "node-a",
      ),
    ).toThrow('does not exactly match the declared command verification "just ci"');
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
    expect(verificationRunSummary("failed", "just test")).toBe(
      "verification command failed: just test",
    );
    expect(verificationRunSummary("timed_out", "just slow")).toBe(
      "verification command timed_out: just slow",
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
    expect(advanceNextAction("review", false)).toMatch(/independent audit/);
  });
});
