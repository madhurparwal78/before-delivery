import http from "node:http";
import { config } from "./config.js";
import { handleApi, send } from "./http.js";
import { staticReply } from "./pages.js";
import "./routes/binder.js";
import "./routes/bookings.js";
import "./routes/documents.js";
import "./routes/holds.js";
import "./routes/packs.js";
import "./routes/policies.js";
import "./routes/renters.js";
import "./routes/reports.js";
import "./routes/session.js";
import "./routes/sites.js";
import { prepareDatabase } from "./seed.js";
import { startWorkers } from "./workers.js";

await prepareDatabase();

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://hearthshift");
  void handleApi(request, url, async () => staticReply(request.method ?? "GET", url.pathname)).then((reply) => send(response, reply));
});
server.keepAliveTimeout = 65000;
server.listen(config.port, "0.0.0.0", () => console.log(`Hearthshift listening on port ${config.port}`));
startWorkers();
