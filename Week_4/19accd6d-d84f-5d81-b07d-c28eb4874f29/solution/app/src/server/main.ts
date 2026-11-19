import { createServer } from "node:http";
import { prepareDatabase } from "./db";
import { settings } from "./config";
import { notFound, sendError } from "./errors";
import { dispatch } from "./http";
import { attachLiveChannel } from "./live";
import { routes } from "./routes";
import { startIndexer } from "./search";
import { startSnapshotRetry } from "./snapshots";
import { serveStatic } from "./static";

async function main(): Promise<void> {
  await prepareDatabase();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/api/")) {
      void dispatch(routes, req, res, url);
    } else if (req.method === "GET" || req.method === "HEAD") {
      void serveStatic(url.pathname, res);
    } else {
      sendError(res, notFound());
    }
  });
  attachLiveChannel(server);
  server.listen(settings.port, "0.0.0.0", () => console.log(`wringbench listening on ${settings.port}`));
  startIndexer();
  startSnapshotRetry();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
