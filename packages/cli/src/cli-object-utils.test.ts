import { describe, expect, it } from "vite-plus/test";
import {
  arrayAtPath,
  asRecord,
  canonicalSnapshotFrom,
  formatUnknown,
  isNonEmptyString,
  isRecord,
  nullableStringField,
  numberAt,
  optionalNumberField,
  optionalStringArrayField,
  optionalStringField,
  parseVerification,
  requiredNodeStringField,
  strictArrayAtPath,
  strictStringArrayAt,
  strictStringArrayField,
  strictVerificationArrayAt,
  stringAt,
  valueAtPath,
} from "./object-utils.js";

describe("object utility contracts", () => {
  it("reads nested scalar and array paths without coercing invalid shapes", () => {
    const source = { node: { title: "Alpha", points: "3", tags: ["app", "runtime"] } };
    expect(valueAtPath(source, "node.title")).toBe("Alpha");
    expect(valueAtPath(source, "node.missing")).toBeUndefined();
    expect(valueAtPath(null, "node.title")).toBeUndefined();
    expect(stringAt(source, "node.title")).toBe("Alpha");
    expect(stringAt({ node: { title: 1 } }, "node.title")).toBeUndefined();
    expect(numberAt(source, "node.points")).toBe(3);
    expect(numberAt({ node: { points: 4 } }, "node.points")).toBe(4);
    expect(numberAt({ node: { points: " " } }, "node.points")).toBeUndefined();
    expect(numberAt({ node: { points: "nope" } }, "node.points")).toBeUndefined();
    expect(arrayAtPath(source, "node.tags")).toEqual(["app", "runtime"]);
    expect(arrayAtPath(source, "node.title")).toEqual([]);
    expect(strictArrayAtPath(source, "node.tags", true)).toEqual(["app", "runtime"]);
    expect(strictArrayAtPath(source, "node.missing", false)).toEqual([]);
    expect(() => strictArrayAtPath(source, "node.title", true)).toThrow(/Expected node.title/);
    expect(() => strictArrayAtPath(source, "node.missing", true)).toThrow(/Expected node.missing/);
  });

  it("validates object field helpers loudly", () => {
    const record = {
      id: "node-a",
      node_id: "node-b",
      summary: "text",
      blank: " ",
      maybe: null,
      count: 2,
      list: ["a", "b"],
    };
    expect(asRecord(record, "record")).toBe(record);
    expect(() => asRecord([], "record")).toThrow(/record must be an object/);
    expect(requiredNodeStringField(record, "id", "record")).toBe("node-a");
    expect(requiredNodeStringField({ node_id: "node-b" }, "id", "record", "node_id")).toBe(
      "node-b",
    );
    expect(() => requiredNodeStringField(record, "blank", "record")).toThrow(/record.blank/);
    expect(optionalStringField(record, "summary", "record")).toBe("text");
    expect(optionalStringField(record, "maybe", "record")).toBeUndefined();
    expect(() => optionalStringField({ summary: 1 }, "summary", "record")).toThrow(/string/);
    expect(nullableStringField(record, "maybe", "record")).toBeNull();
    expect(nullableStringField(record, "summary", "record")).toBe("text");
    expect(nullableStringField(record, "missing", "record")).toBeUndefined();
    expect(() => nullableStringField({ summary: 1 }, "summary", "record")).toThrow(
      /string or null/,
    );
    expect(optionalNumberField(record, "count", "record")).toBe(2);
    expect(optionalNumberField(record, "maybe", "record")).toBeUndefined();
    expect(() => optionalNumberField({ count: Number.NaN }, "count", "record")).toThrow(/number/);
    expect(optionalStringArrayField(record, "list", "record")).toEqual(["a", "b"]);
    expect(optionalStringArrayField(record, "maybe", "record")).toBeUndefined();
    expect(() => optionalStringArrayField({ list: ["a", 1] }, "list", "record")).toThrow(
      /array of strings/,
    );
    expect(strictStringArrayField(record, "list", "record")).toEqual(["a", "b"]);
    expect(strictStringArrayField(record, "missing", "record")).toEqual([]);
  });

  it("parses verification and string arrays strictly", () => {
    expect(parseVerification("type=command,value=just ci")).toEqual({
      type: "command",
      value: "just ci",
    });
    expect(parseVerification("owner review")).toEqual({ type: "manual", value: "owner review" });
    expect(parseVerification("type=note,value=a=b")).toEqual({ type: "note", value: "a=b" });
    expect(() => parseVerification("type=script,value=run")).toThrow(/Unknown verification/);
    expect(strictStringArrayAt({ tags: "one" }, "tags", "tags")).toEqual(["one"]);
    expect(strictStringArrayAt({ tags: " " }, "tags", "tags")).toEqual([]);
    expect(strictStringArrayAt({ tags: ["one", " "] }, "tags", "tags")).toEqual(["one"]);
    expect(strictStringArrayAt({ tags: null }, "tags", "tags")).toEqual([]);
    expect(() => strictStringArrayAt({ tags: 1 }, "tags", "tags")).toThrow(/string array/);
    expect(() => strictStringArrayAt({ tags: ["one", 1] }, "tags", "tags")).toThrow(/tags\[1\]/);
    expect(
      strictVerificationArrayAt(
        { verification: ["type=url,value=https://example.test", { type: "manual", value: "ok" }] },
        "verification",
        "verification",
      ),
    ).toEqual([
      { type: "url", value: "https://example.test" },
      { type: "manual", value: "ok" },
    ]);
    expect(
      strictVerificationArrayAt({ verification: null }, "verification", "verification"),
    ).toEqual([]);
    expect(() =>
      strictVerificationArrayAt({ verification: "manual" }, "verification", "verification"),
    ).toThrow(/must be an array/);
    expect(() =>
      strictVerificationArrayAt({ verification: [1] }, "verification", "verification"),
    ).toThrow(/must be a string or object/);
  });

  it("recognizes canonical snapshots and formats unknown values", () => {
    expect(canonicalSnapshotFrom({})).toBeUndefined();
    expect(canonicalSnapshotFrom(null)).toBeUndefined();
    expect(() => canonicalSnapshotFrom({ schema_version: 3 })).toThrow(/Unsupported/);
    expect(() => canonicalSnapshotFrom({ schema_version: 1, registries: [] })).toThrow(
      /registries/,
    );
    expect(() =>
      canonicalSnapshotFrom({ schema_version: 1, exported_at: "", registries: {} }),
    ).toThrow(/exported_at/);
    const snapshot = canonicalSnapshotFrom({
      schema_version: 1,
      exported_at: "2026-06-28T00:00:00.000Z",
      registries: { groups: [], projects: [], milestones: [] },
      nodes: [],
      edges: [],
      findings: [],
      runs: [],
      node_notes: [],
    });
    expect(snapshot).toMatchObject({ schema_version: 2, assignments: [], waves: [] });
    const oldSnapshot = canonicalSnapshotFrom({
      schema_version: 1,
      exported_at: "2026-06-28T00:00:00.000Z",
      registries: { groups: [], projects: [], milestones: [] },
      nodes: [
        {
          id: "old",
          title: "Old export",
          kind: "feature",
          status: "ready",
          priority: "P2",
          estimate_points: 1,
          risk: "medium",
          spec: "Do the work",
          acceptance: "The work is done",
          created_at: "2026-06-28T00:00:00.000Z",
          updated_at: "2026-06-28T00:00:00.000Z",
        },
      ],
      edges: [],
      findings: [],
      runs: [],
      node_notes: [],
    });
    expect(oldSnapshot?.nodes[0]).toMatchObject({
      blocked_by: null,
      blocked_reason: null,
      verification: [],
      audit_focus: [],
    });
    expect(() =>
      canonicalSnapshotFrom({
        schema_version: 1,
        exported_at: "now",
        registries: { groups: [], projects: [], milestones: [] },
        nodes: {},
      }),
    ).toThrow(/nodes must be an array/);
    expect(formatUnknown("x")).toBe("x");
    expect(formatUnknown(1)).toBe("1");
    expect(formatUnknown(true)).toBe("true");
    expect(formatUnknown({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isNonEmptyString(" x ")).toBe(true);
    expect(isNonEmptyString(" ")).toBe(false);
  });
});
