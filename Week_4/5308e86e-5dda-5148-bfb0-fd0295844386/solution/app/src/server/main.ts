/** Process entry: listen at once, then bring the database up in the background. */
import { createServer } from "node:http";
import { config } from "./config.js";
import { handlePage } from "./pages.js";
import { handleApi } from "./server.js";
import { prepareDatabase, runDueWork, watchDatabase } from "./lifecycle.js";

const server = createServer((req, res) => {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://tallwind.local");
  } catch {
    res.writeHead(404).end();
    return;
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) void handleApi(req, res, url);
  else void handlePage(req, res, url);
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.listen(config.port, "0.0.0.0");

watchDatabase();
runDueWork();
void prepareDatabase();

function shutdown(): void {
  server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (reason) => console.error(reason));
