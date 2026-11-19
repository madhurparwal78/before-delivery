import { createServer } from "node:http";
import "./api-account";
import "./api-items";
import "./api-live";
import "./api-plan";
import "./setup";
import { settings } from "./config";
import { applySchema } from "./db";
import { handleApi, handleUpgrade, sendJson } from "./http";
import { startNoticeQueue } from "./notices";
import { handleStatic } from "./static";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", settings.publicUrl);
  const handled = url.pathname === "/api" || url.pathname.startsWith("/api/") ? handleApi(req, res, url) : handleStatic(req, res, url);
  handled.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "server_error" });
  });
});

// Clients that pool keep-alive sockets (browsers, Playwright's request context) reuse an idle socket
// without warning; Node's 5 s default closes it under them and the next request reads "socket hang up".
// Keep idle sockets far longer than any client's pause so the server is never the side that drops them.
server.keepAliveTimeout = 10 * 60_000;

server.on("upgrade", (req, socket) => {
  void handleUpgrade(req, socket, new URL(req.url ?? "/", settings.publicUrl));
});

await applySchema();
startNoticeQueue();
server.listen(settings.port, "0.0.0.0");
