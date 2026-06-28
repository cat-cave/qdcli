import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsReport, graphSnapshot } from "@cat-cave/qdcli-core";
import { numberOpt, output, stringOpt } from "./args.js";
import { pathExists } from "./fs-utils.js";

export async function viewCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const assetsDir = await findViewerAssetsDir();
  if (options.check) {
    return output({ ok: true, viewer: "embedded", assetsDir }, json);
  }

  const host = stringOpt(options.host) ?? "127.0.0.1";
  const port = numberOpt(options.port) ?? 5173;
  const server = createServer((request, response) => {
    void handleViewerRequest(root, assetsDir, request, response);
  });

  await listen(server, port, host);
  const address = server.address() as AddressInfo;
  const url = `http://${hostForUrl(host)}:${address.port}/`;

  if (json) console.log(JSON.stringify({ ok: true, viewer: "embedded", url, root }, null, 2));
  else console.log(`Serving qd viewer at ${url}`);

  if (options.open) openUrl(url);

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    const shutdown = () => {
      server.close((error) => (error ? reject(error) : resolve()));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export async function isSourceCheckout(): Promise<boolean> {
  const workspaceRoot = findWorkspaceRoot();
  return (
    (await pathExists(path.join(workspaceRoot, "pnpm-workspace.yaml"))) &&
    (await pathExists(path.join(workspaceRoot, "apps", "viewer")))
  );
}

export async function viewerRuntime(): Promise<string> {
  try {
    await findViewerAssetsDir();
    return "embedded";
  } catch {
    return "missing";
  }
}

export async function handleViewerRequest(
  root: string,
  assetsDir: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/api/graph") {
      return sendJson(response, await graphSnapshot(root), request.method === "HEAD");
    }
    if (requestUrl.pathname === "/api/analytics") {
      return sendJson(response, await analyticsReport(root), request.method === "HEAD");
    }

    const filePath = await viewerFilePath(assetsDir, requestUrl.pathname);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": contentType(filePath) });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

export async function viewerFilePath(assetsDir: string, pathname: string): Promise<string> {
  const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const resolved = path.resolve(assetsDir, `.${relative}`);
  const root = path.resolve(assetsDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Viewer path escapes asset root");
  }
  if (await pathExists(resolved)) return resolved;
  if (pathname.startsWith("/assets/") || path.extname(pathname)) return resolved;
  return path.join(assetsDir, "index.html");
}

export function contentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

async function findViewerAssetsDir(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const assetsDir = path.join(here, "viewer");
  if (await pathExists(path.join(assetsDir, "index.html"))) return assetsDir;
  throw new Error(
    "qd view assets are missing. Reinstall qd or rebuild the package so the embedded viewer is included.",
  );
}

function sendJson(response: ServerResponse, payload: unknown, headOnly: boolean): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  if (headOnly) response.end();
  else response.end(JSON.stringify(payload));
}

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function openUrl(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(opener, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function findWorkspaceRoot(): string {
  return path.resolve(new URL("../../..", import.meta.url).pathname);
}
