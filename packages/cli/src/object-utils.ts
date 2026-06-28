import type { GraphSnapshot, VerificationEntry } from "@cat-cave/qdcli-core";

export function parseVerification(value: string): VerificationEntry {
  const fields = Object.fromEntries(
    value.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key?.trim(), rest.join("=").trim()];
    }),
  );
  const type = fields.type || "manual";
  const entryValue = fields.value || value;
  if (type !== "command" && type !== "manual" && type !== "url" && type !== "note") {
    throw new Error(`Unknown verification type: ${type}`);
  }
  return { type, value: entryValue };
}

export function strictArrayAtPath(
  source: unknown,
  pathText: string,
  requiredPath: boolean,
): unknown[] {
  const value = valueAtPath(source, pathText);
  if (value === undefined) {
    if (requiredPath) throw new Error(`Expected ${pathText} to be an array`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`Expected ${pathText} to be an array`);
  return value;
}

export function arrayAtPath(source: unknown, pathText: string): unknown[] {
  const value = valueAtPath(source, pathText);
  return Array.isArray(value) ? value : [];
}

export function stringAt(source: unknown, pathText: string): string | undefined {
  const value = valueAtPath(source, pathText);
  return typeof value === "string" ? value : undefined;
}

export function numberAt(source: unknown, pathText: string): number | undefined {
  const value = valueAtPath(source, pathText);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function strictStringArrayAt(source: unknown, pathText: string, label: string): string[] {
  const value = valueAtPath(source, pathText);
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) throw new Error(`${label} at ${pathText} must be a string array`);
  const invalidIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidIndex !== -1)
    throw new Error(`${label} at ${pathText}[${invalidIndex}] must be a string`);
  return value.filter((item) => item.trim());
}

export function strictVerificationArrayAt(
  source: unknown,
  pathText: string,
  label: string,
): VerificationEntry[] {
  const value = valueAtPath(source, pathText);
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} at ${pathText} must be an array`);
  return value.map((item, index): VerificationEntry => {
    if (typeof item === "string") return parseVerification(item);
    if (item && typeof item === "object") {
      const type = stringAt(item, "type") ?? "manual";
      const entryValue = stringAt(item, "value");
      if (!entryValue) throw new Error(`${label}[${index}].value is required`);
      return parseVerification(`type=${type},value=${entryValue}`);
    }
    throw new Error(`${label}[${index}] must be a string or object`);
  });
}

export function canonicalSnapshotFrom(source: unknown): GraphSnapshot | undefined {
  if (!isRecord(source) || source.schema_version === undefined) return undefined;
  if (source.schema_version !== 1) {
    throw new Error(
      `Unsupported qd export schema_version: ${formatUnknown(source.schema_version)}`,
    );
  }
  const registries = valueAtPath(source, "registries");
  if (!isRecord(registries)) throw new Error("qd export registries must be an object");
  return {
    schema_version: 1,
    exported_at: requiredStringField(source, "exported_at"),
    registries: {
      groups: requiredArrayField(registries, "groups"),
      projects: requiredArrayField(registries, "projects"),
      milestones: requiredArrayField(registries, "milestones"),
    },
    nodes: requiredArrayField(source, "nodes"),
    edges: requiredArrayField(source, "edges"),
    findings: requiredArrayField(source, "findings"),
    runs: requiredArrayField(source, "runs"),
    node_notes: requiredArrayField(source, "node_notes"),
    assignments: optionalArrayField(source, "assignments"),
    waves: optionalArrayField(source, "waves"),
    wave_memberships: optionalArrayField(source, "wave_memberships"),
  } as GraphSnapshot;
}

export function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
  return value;
}

export function requiredNodeStringField(
  value: Record<string, unknown>,
  field: string,
  context: string,
  alias?: string,
): string {
  const raw = value[field] ?? (alias ? value[alias] : undefined);
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${context}.${field} is required`);
  return raw;
}

export function optionalStringField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error(`${context}.${field} must be a string`);
  return raw;
}

export function nullableStringField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string | null | undefined {
  const raw = value[field];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new Error(`${context}.${field} must be a string or null`);
  return raw;
}

export function optionalNumberField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): number | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`${context}.${field} must be a number`);
  }
  return raw;
}

export function optionalStringArrayField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string[] | undefined {
  const raw = value[field];
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new Error(`${context}.${field} must be an array of strings`);
  }
  return raw;
}

export function strictStringArrayField(
  value: Record<string, unknown>,
  key: string,
  context: string,
): string[] {
  return optionalStringArrayField(value, key, context) ?? [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function formatUnknown(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "<unknown>";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function valueAtPath(source: unknown, pathText: string): unknown {
  return pathText.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function requiredStringField(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`qd export ${field} is required`);
  return value;
}

function requiredArrayField<T = unknown>(source: Record<string, unknown>, field: string): T[] {
  const value = source[field];
  if (!Array.isArray(value)) throw new Error(`qd export ${field} must be an array`);
  return value as T[];
}

function optionalArrayField<T = unknown>(source: Record<string, unknown>, field: string): T[] {
  const value = source[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`qd export ${field} must be an array`);
  return value as T[];
}
