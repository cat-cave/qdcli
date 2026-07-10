import { stringOpt } from "./args.js";
import { graphCommand } from "./project-commands.js";

export async function planCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "export") {
    return graphCommand(root, { ...options, format: stringOpt(options.format) ?? "json" }, json);
  }
  if (action === "import") {
    throw new Error(
      "qd plan import is reserved for the next trial iteration; use qd node add and qd edge add for now",
    );
  }
  throw new Error(`Unknown plan action: ${action}`);
}
