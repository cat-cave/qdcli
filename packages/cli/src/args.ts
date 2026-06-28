export interface ParsedArgs {
  command: string[];
  options: Record<string, string | string[] | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | string[] | boolean> = {};
  const repeatableOptions = new Set([
    "project",
    "verify",
    "verification",
    "audit-focus",
    "repo",
    "commit",
    "evidence",
    "env",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const key = requiredArg(rawKey, "option name");
      const next = argv[i + 1];
      const hasInlineValue = inlineValue !== undefined;
      const value = hasInlineValue ? inlineValue : next && !next.startsWith("-") ? next : true;
      if (!hasInlineValue && value !== true) i += 1;

      const current = options[key];
      if (current !== undefined && !repeatableOptions.has(key)) {
        throw new Error(`Option --${key} cannot be repeated`);
      }
      if (repeatableOptions.has(key)) {
        if (Array.isArray(current)) current.push(String(value));
        else if (typeof current === "string") options[key] = [current, String(value)];
        else options[key] = [String(value)];
      } else {
        options[key] = value;
      }
    } else {
      command.push(arg);
    }
  }
  return { command, options };
}

export function output(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    console.table(value);
    return;
  }
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

export function required(value: string | string[] | boolean | undefined, name: string): string {
  const resolved = stringOpt(value);
  if (!resolved) throw new Error(`${name} is required`);
  return resolved;
}

export function requiredArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parsePositiveInteger(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

export function parseBoolean(value: string, key: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be true or false`);
}

export function stringOpt(value: string | string[] | boolean | undefined): string | undefined {
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === "string" ? value : undefined;
}

export function stringListOpt(value: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

export function numberOpt(value: string | string[] | boolean | undefined): number | undefined {
  const text = stringOpt(value);
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${text}`);
  return parsed;
}

export function requiredNumber(
  value: string | string[] | boolean | undefined,
  name: string,
): number {
  const parsed = numberOpt(value);
  if (parsed === undefined || Number.isNaN(parsed)) throw new Error(`${name} is required`);
  return parsed;
}

export function stripUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

export function hasOption(options: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}
