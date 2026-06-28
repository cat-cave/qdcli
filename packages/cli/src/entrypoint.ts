import { realpathSync } from "node:fs";
import path from "node:path";

export function isCliEntrypoint(argvPath: string | undefined, modulePath: string): boolean {
  if (!argvPath) return false;
  return realPath(argvPath) === realPath(modulePath);
}

function realPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
