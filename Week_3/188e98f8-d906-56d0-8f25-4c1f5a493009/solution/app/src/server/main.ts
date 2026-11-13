import http from "node:http";
import { config } from "./config";
import { connectAndMigrate } from "./db";
import { retryQueuedNotes } from "./disputes";
import { ApiError } from "./errors";
import { dispatchApi, writeReply } from "./http";
import { servePage } from "./pages";
import { keepBucketReady } from "./storage";

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    dispatchApi(req, url)
      .then((reply) => writeReply(req, res, reply))
      .catch((error: unknown) => {
        const failure = error instanceof ApiError ? error : new ApiError(500, { error: "server_error" });
        writeReply(req, res, { status: failure.status, body: failure.body, headers: failure.headers });
      });
    return;
  }
  servePage(req, res, url.pathname).catch(() => {
    res.writeHead(500);
    res.end();
  });
});

server.listen(config.port, "0.0.0.0");

void connectAndMigrate().then(() => {
  retryQueuedNotes();
});
void keepBucketReady();
