import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { __testing } from "./index.js";
import {
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  qdJsonAllowExit,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd CLI viewer and public lifecycle surfaces", () => {
  async function writeCompletionReport(id: string): Promise<string> {
    const reportPath = path.join(root, `${id}-completion.json`);
    await writeFile(
      reportPath,
      `${JSON.stringify({
        nodeId: id,
        summary: "Implementation completed.",
        changedFiles: [`src/${id}.ts`],
        acceptanceEvidence: [
          {
            criterion: "The fixture passes audit, verification, check, CI, and merge recording.",
            status: "passed",
            evidence: "reports/lifecycle-acceptance.md",
          },
        ],
        commandsRun: [
          {
            command: "manual lifecycle fixture",
            status: "passed",
            evidence: "logs/lifecycle.log",
          },
        ],
        evidence: ["reports/lifecycle-completion.md"],
        realWorldValidation: {
          required: false,
          status: "not_required",
          evidence: "No external integration in lifecycle fixture.",
        },
        unverifiedItems: [],
        dagChangesNeeded: [],
      })}\n`,
      "utf8",
    );
    return reportPath;
  }

  it("serves embedded viewer assets and live DAG endpoints through the viewer handler", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await qd(
      "node",
      "add",
      "--id",
      "viewer-node",
      "--title",
      "Viewer node",
      "--spec",
      "Render the graph.",
      "--acceptance",
      "The viewer serves the graph.",
    );
    const doctor = await qdJsonAllowExit("doctor", "--json");
    expect(doctor.json.runtime.sourceCheckout).toBe(true);
    expect(["embedded", "missing"]).toContain(doctor.json.runtime.viewer);
    const assetsDir = path.join(root, "viewer-assets");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(path.join(assetsDir, "folder"), { recursive: true });
    await writeFile(path.join(assetsDir, "index.html"), "<main>qd viewer</main>", "utf8");
    await writeFile(path.join(assetsDir, "app.js"), "window.qdViewer = true;", "utf8");
    await writeFile(path.join(assetsDir, "style.css"), "body { color: black; }", "utf8");
    await writeFile(path.join(assetsDir, "data.json"), '{"ok":true}', "utf8");

    const server = createServer((request, response) => {
      void __testing.handleViewerRequest(root, assetsDir, request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    const base = `http://${__testing.hostForUrl(address.address)}:${address.port}`;
    try {
      const graph = await fetch(`${base}/api/graph`).then(
        (response) => response.json() as Promise<any>,
      );
      expect(graph.nodes.map((node: any) => node.id)).toEqual(["viewer-node"]);
      expect(
        await fetch(`${base}/api/analytics`).then((response) => response.json() as Promise<any>),
      ).toHaveProperty("stats.nodes", 1);
      const graphHead = await fetch(`${base}/api/graph`, { method: "HEAD" });
      expect(graphHead.status).toBe(200);
      expect(await graphHead.text()).toBe("");
      const directHead = mockResponse();
      await __testing.handleViewerRequest(
        root,
        assetsDir,
        { method: "HEAD", url: "/api/analytics" } as any,
        directHead as any,
      );
      expect(directHead.statusCode).toBe(200);
      expect(directHead.headers).toHaveProperty("content-type", "application/json; charset=utf-8");
      expect(directHead.body).toBeUndefined();
      const index = await fetch(`${base}/`).then((response) => response.text());
      expect(index).toContain("qd viewer");
      expect(await fetch(`${base}/nested/viewer-route`).then((response) => response.text())).toBe(
        index,
      );
      expect((await fetch(`${base}/app.js`)).headers.get("content-type")).toContain(
        "text/javascript",
      );
      expect((await fetch(`${base}/style.css`, { method: "HEAD" })).status).toBe(200);
      expect(__testing.contentType("file.css")).toContain("text/css");
      expect((await fetch(`${base}/data.json`)).headers.get("content-type")).toContain(
        "application/json",
      );
      const missingAsset = await fetch(`${base}/missing.js`);
      expect(missingAsset.status).toBe(404);
      expect(missingAsset.headers.get("content-type")).toContain("text/plain");
      const directoryResponse = await fetch(`${base}/folder`);
      expect(directoryResponse.status).toBe(500);
      expect(directoryResponse.headers.get("content-type")).toContain("application/json");
      expect(await directoryResponse.json()).toHaveProperty("error", "not a file");
      const postResponse = await fetch(`${base}/api/graph`, { method: "POST" });
      expect(postResponse.status).toBe(405);
      expect(postResponse.headers.get("content-type")).toContain("text/plain");
      await expect(__testing.viewerFilePath(assetsDir, "/missing-route")).resolves.toBe(
        path.join(assetsDir, "index.html"),
      );
      await expect(__testing.viewerFilePath(assetsDir, "/assets/missing")).resolves.toBe(
        path.join(assetsDir, "assets", "missing"),
      );
      await expect(__testing.viewerFilePath(assetsDir, "/../secret.txt")).rejects.toThrow(
        /escapes asset root/,
      );
      await expect(__testing.viewerFilePath(assetsDir, "/%2e%2e/secret.txt")).rejects.toThrow(
        /escapes asset root/,
      );
      expect(__testing.contentType("file.html")).toContain("text/html");
      expect(__testing.contentType("file.svg")).toBe("image/svg+xml");
      expect(__testing.contentType("file.json")).toContain("application/json");
      expect(__testing.contentType("file.bin")).toBe("application/octet-stream");
      expect(__testing.hostForUrl("::1")).toBe("[::1]");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("runs a clean implementation-to-merge lifecycle through public commands", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await qd("config", "set", "require_clean_worktree", "false");
    await qd(
      "node",
      "add",
      "--id",
      "lifecycle-node",
      "--title",
      "Lifecycle node",
      "--spec",
      "Implement a small lifecycle fixture.",
      "--acceptance",
      "The fixture passes audit, verification, check, CI, and merge recording.",
      "--verify",
      "type=manual,value=owner sign-off",
    );
    await qd("claim", "lifecycle-node", "--agent", "worker", "--branch", "spec/lifecycle-node");
    await qd(
      "complete",
      "lifecycle-node",
      "--from-report",
      await writeCompletionReport("lifecycle-node"),
    );
    const ciGateBeforeEvidence = await qdJsonAllowExit(
      "gate",
      "lifecycle-node",
      "--phase",
      "ci",
      "--json",
    );
    expect(ciGateBeforeEvidence.exitCode).toBe(1);
    expect(ciGateBeforeEvidence.json.structuralOk).toBe(true);
    expect(
      ciGateBeforeEvidence.json.policy.selected.violations.map((item: any) => item.code),
    ).toEqual(["auditRequired", "verificationRequired"]);

    await writeFile(
      path.join(root, "audit-report.json"),
      `${JSON.stringify({
        nodeId: "lifecycle-node",
        acceptanceReviewed: [
          {
            criterion: "The fixture passes audit, verification, check, CI, and merge recording.",
            status: "passed",
            evidence: "reports/lifecycle-acceptance.md",
          },
        ],
        verificationEvidence: {
          diffReviewed: true,
          completionReportReviewed: true,
          verificationEvidenceReviewed: true,
        },
        realWorldValidation: {
          required: false,
          status: "not_required",
          evidence: "No external integration in lifecycle fixture.",
        },
        findings: [],
      })}\n`,
      "utf8",
    );
    await qd("audit", "start", "lifecycle-node", "--kind", "acceptance");
    const audit = await qdJson(
      "audit",
      "pass",
      "lifecycle-node",
      "--from-report",
      "audit-report.json",
      "--json",
    );
    expect(audit.ok).toBe(true);

    const signoff = await qdJson(
      "verification",
      "sign-off",
      "lifecycle-node",
      "--type",
      "manual",
      "--value",
      "owner sign-off",
      "--note",
      "Owner approved the manual gate.",
      "--evidence",
      "reports/owner-signoff.md",
      "--json",
    );
    expect(signoff.ok).toBe(true);
    expect((await qdJson("gate", "lifecycle-node", "--phase", "ci", "--json")).ok).toBe(true);

    expect(
      (
        await qdJson(
          "check",
          "run",
          "lifecycle-node",
          "--cmd",
          'node -e "process.exit(0)"',
          "--json",
        )
      ).ok,
    ).toBe(true);
    const mergeGateBeforeCi = await qdJsonAllowExit(
      "gate",
      "lifecycle-node",
      "--phase",
      "merge",
      "--json",
    );
    expect(mergeGateBeforeCi.exitCode).toBe(1);
    expect(
      mergeGateBeforeCi.json.policy.selected.violations.map((item: any) => item.code),
    ).toContain("ciRequired");
    expect(
      (await qdJson("ci", "run", "lifecycle-node", "--cmd", 'node -e "process.exit(0)"', "--json"))
        .ok,
    ).toBe(true);
    expect((await qdJson("gate", "lifecycle-node", "--phase", "merge", "--json")).ok).toBe(true);
    await expectQdFailure(
      /requires --use-existing-commit/,
      "advance",
      "lifecycle-node",
      "--summary",
      "attempt merge recording",
      "--skip-check",
      "--skip-ci",
      "--merge",
    );

    await qd(
      "config",
      "set",
      "hooks_pre_merge",
      "printf 'pre-merge:%s\\n' {node} >> merge-hooks.log",
    );
    await qd(
      "config",
      "set",
      "hooks_post_merge",
      "printf 'post-merge:%s\\n' {node} >> merge-hooks.log",
    );
    const merged = await qdJson(
      "merge",
      "lifecycle-node",
      "--use-existing-commit",
      "abc123",
      "--json",
    );
    expect(merged.status).toBe("done");
    expect(await readFile(path.join(root, "merge-hooks.log"), "utf8")).toBe(
      "pre-merge:lifecycle-node\npost-merge:lifecycle-node\n",
    );
  });
});

function mockResponse(): {
  statusCode: number | null;
  headers: Record<string, string>;
  body: unknown;
  writeHead: (statusCode: number, headers: Record<string, string>) => void;
  end: (body?: unknown) => void;
} {
  return {
    statusCode: null,
    headers: {},
    body: "unset",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}
