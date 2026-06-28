import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(root: string, filePath: string): Promise<unknown> {
  const text = await readTextFile(root, filePath);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readTextFile(root: string, filePath: string): Promise<string> {
  return readFile(path.resolve(root, filePath), "utf8");
}
