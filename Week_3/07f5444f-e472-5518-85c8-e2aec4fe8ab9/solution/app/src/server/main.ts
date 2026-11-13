// Quirewell Stand Desk server: the API under /api and the built client, on APP_PUBLIC_PORT.

import { createServer } from "node:http";
import { config } from "./config.js";
import { pool } from "./db.js";
import { handleApi } from "./http.js";
import { startSweeping } from "./notices.js";
import { prepareDatabase } from "./seed.js";
import { serveClient } from "./static.js";
import "./api/session.js";
import "./api/programmes.js";
import "./api/works.js";
import "./api/scans.js";
import "./api/folders.js";
import "./api/rentals.js";

let ready = false;

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/api/health") {
    response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: ready ? "ok" : "starting" }));
    return;
  }
  if (!ready) {
    response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "starting", message: "The desk is starting." }));
    return;
  }
  const handled = path === "/api" || path.startsWith("/api/") ? handleApi(request, response, path) : serveClient(path, response);
  handled.catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});

server.listen(config.port, "0.0.0.0", () => console.log(`Quirewell Stand Desk listening on ${config.port}`));

async function connect(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await prepareDatabase(client);
      } finally {
        client.release();
      }
      ready = true;
      startSweeping();
      return;
    } catch (error) {
      console.error("waiting for Postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

void connect();
