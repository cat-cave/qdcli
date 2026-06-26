import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { analyticsReport, graphSnapshot } from "@cat-cave/qdcli-core";
import { defineConfig, lazyPlugins, type ViteDevServer } from "vite-plus";

type MiddlewareHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

function jsonHandler(load: () => Promise<unknown>): MiddlewareHandler {
  return async (_request, response) => {
    try {
      const payload = await load();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    } catch (error) {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
}

export default defineConfig({
  plugins: lazyPlugins(async () => [
    react(),
    {
      name: "qd-graph-api",
      configureServer(server: ViteDevServer) {
        server.middlewares.use(
          "/api/graph",
          jsonHandler(() => graphSnapshot(process.env.QD_ROOT ?? process.cwd())),
        );
        server.middlewares.use(
          "/api/analytics",
          jsonHandler(() => analyticsReport(process.env.QD_ROOT ?? process.cwd())),
        );
      },
    },
  ]),
});
