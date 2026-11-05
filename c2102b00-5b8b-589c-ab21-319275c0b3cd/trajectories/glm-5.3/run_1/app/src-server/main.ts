import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config, db, applySchema, seedIfEmpty } from "./db";
import { viewerOf, sendJson } from "./http/http";
import { handleApi } from "./http/routes";
import { serveStatic } from "./http/static";
import { startMailWorker } from "./providers/mailworker";
import { scheduleSlipCleanup } from "./domain/documents";

applySchema();
seedIfEmpty();
startMailWorker();
scheduleSlipCleanup();

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const viewer = viewerOf(req);
      const handled = await handleApi(req, res, url, viewer);
      if (!handled) {
        sendJson(res, 404, { error: { code: "not_found", message: "Nothing is at that address." } });
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (!serveStatic(req, res, url.pathname)) {
        res.writeHead(405, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("Method not allowed");
      }
      return;
    }
    if (!serveStatic(req, res, url.pathname)) {
      serveStatic(req, res, "/");
    }
  })();
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`tare-and-tally listening on 0.0.0.0:${config.port}`);
});
