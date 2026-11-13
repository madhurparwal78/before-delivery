// Keelson: one process serving the JSON API and the workspace from one port.
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { notFound } from "./access.js";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { type Ctx, clientFile, errorReply, json, readRequest, send } from "./http.js";
import { startWorkers } from "./outbox.js";
import { route } from "./routes/index.js";
import { prepareDatabase } from "./seed.js";

let ready = false;

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://keelson.invalid");
  const method = req.method ?? "GET";
  if (url.pathname === "/api/health" && method === "GET") {
    send(res, ready ? json(200, { status: "ok" }) : json(503, { status: "starting" }));
    return;
  }
  try {
    const raw = await readRequest(req, method, url.pathname);
    if (!url.pathname.startsWith("/api/")) {
      const file = method === "GET" ? await clientFile(url.pathname) : null;
      if (!file) throw notFound("The page");
      send(res, file);
      return;
    }
    if (!ready) throw new ApiError("storage_unavailable", "Keelson is starting and cannot reach its database yet.");
    const found = route(method, url.pathname);
    if (!found) throw notFound("The resource");
    const ctx: Ctx = { req, method, path: url.pathname, query: url.searchParams, raw, now: new Date() };
    send(res, await found.handler(ctx, found.params));
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, errorReply(error));
    } else {
      console.error(`${method} ${url.pathname} failed:`, error instanceof Error ? error.message : error);
      send(res, errorReply(new ApiError("storage_unavailable", "Keelson could not complete the request. Try again shortly.")));
    }
  }
}

const server = http.createServer((req, res) => void handle(req, res));
server.listen(config.port, "0.0.0.0", () => console.log(`Keelson listening on 0.0.0.0:${config.port}`));

async function boot(): Promise<void> {
  for (;;) {
    try {
      await prepareDatabase();
      ready = true;
      startWorkers();
      console.log("Keelson is ready");
      return;
    } catch (error) {
      console.error("waiting for Postgres:", error instanceof Error ? error.message : error);
      await sleep(2_000);
    }
  }
}

void boot();
process.on("SIGTERM", () => server.close(() => process.exit(0)));
