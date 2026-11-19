import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { dispatch, sendJson } from "./http/pipeline.js";
import { staticFiles } from "./http/static.js";
import { calendarRoutes } from "./routes/calendar.js";
import { feeRoutes } from "./routes/fees.js";
import { holdRoutes } from "./routes/holds.js";
import { itemRoutes } from "./routes/items.js";
import { loanRoutes } from "./routes/loans.js";
import { memberRoutes } from "./routes/members.js";
import { sessionRoutes } from "./routes/session.js";
import { migrate } from "./schema.js";
import { startWorkers } from "./workers.js";

const routes = [...sessionRoutes, ...memberRoutes, ...itemRoutes, ...calendarRoutes, ...holdRoutes, ...loanRoutes, ...feeRoutes];
const serveStatic = staticFiles(join(dirname(fileURLToPath(import.meta.url)), "..", "client"));
let ready = false;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/health") {
    sendJson(res, ready ? 200 : 503, { status: ready ? "ok" : "starting" });
    return;
  }
  if (url.pathname.startsWith("/api/")) void dispatch(routes, req, res, url);
  else void serveStatic(req, res, url);
});

server.listen(config.port, "0.0.0.0", () => console.log(`Pegworth Desk listening on 0.0.0.0:${config.port}`));

async function connect(): Promise<void> {
  while (!ready) {
    try {
      await migrate();
      ready = true;
    } catch (error) {
      console.error(`Postgres not ready (${error instanceof Error ? error.message : String(error)}); retrying in 2 s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  startWorkers();
}

void connect();
