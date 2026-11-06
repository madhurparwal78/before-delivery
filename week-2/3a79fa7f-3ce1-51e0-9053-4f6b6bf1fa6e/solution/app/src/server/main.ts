// Entry point: listens at once on 0.0.0.0, answers 503 starting until PostgreSQL holds the schema and seed.
import { createServer } from "node:http";
import { config } from "./config.ts";
import { migrate } from "./db.ts";
import { handleApi, send } from "./http.ts";
import { startSender } from "./outbox.ts";
import { servePage } from "./pages.ts";
import { routes } from "./routes.ts";

const RETRY_MS = 2_000;
let ready = false;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    if (!ready) {
      req.resume();
      send(res, { status: 503, body: { status: "starting" }, headers: { "Retry-After": "2" } });
      return;
    }
    void handleApi(routes, req, res, url);
    return;
  }
  void servePage(req, res, url);
});

server.listen(config.port, "0.0.0.0", () => console.log(`Tern Foils listening on 0.0.0.0:${config.port}`));

async function start(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      ready = true;
      startSender();
      console.log("database ready");
      return;
    } catch (error) {
      console.error("database not ready, retrying in 2 s:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

void start();
