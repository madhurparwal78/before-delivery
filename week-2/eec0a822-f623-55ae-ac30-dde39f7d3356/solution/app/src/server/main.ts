import { createServer } from "node:http";
import { config } from "./config";
import { migrate, waitForDatabase } from "./db";
import { servePage } from "./pages";
import { dispatch } from "./router";
import { seedOnce } from "./seed";
import { ensureBucket } from "./storage";
import { startSweep } from "./sweep";
import "./routes/session";
import "./routes/yachts";
import "./routes/holds";
import "./routes/manifest";
import "./routes/brokers";
import "./routes/passages";
import "./routes/rota";
import "./routes/marinas";
import "./routes/stores";
import "./routes/energy";

await waitForDatabase();
await migrate();
await seedOnce();
ensureBucket().catch((error: Error) => console.log(`storage not reachable yet: ${error.message}`));
startSweep();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const handler = url.pathname.startsWith("/api/") ? dispatch(req, res, url) : servePage(req, res, url);
  handler.catch((error: Error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500).end();
  });
});
server.listen(config.port, "0.0.0.0", () => console.log(`Tidewright serving on 0.0.0.0:${config.port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => process.exit(0));
