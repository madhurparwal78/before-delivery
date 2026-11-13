import http from "node:http";
import { readConfig } from "./config.js";
import { Db } from "./db.js";
import { App } from "./app.js";

const config = readConfig();
export const db = new Db(config);
export const app = new App(config, db);
app.startTimers();

const server = http.createServer((req, res) => {
  app.handle(req, res).catch((err) => {
    console.error("request failed", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: "INTERNAL" }));
  });
});

server.on("upgrade", (req, socket, head) => {
  app.handleUpgrade(req, socket, head);
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Due Coin serving on 0.0.0.0:${config.port}`);
});

// Apply the schema idempotently, and retry while the database is down.
async function applySchemaWithRetry() {
  for (;;) {
    try {
      await db.applySchema();
      await app.seedCatalog();
      console.log("schema applied");
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`database not ready: ${message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
void applySchemaWithRetry();

