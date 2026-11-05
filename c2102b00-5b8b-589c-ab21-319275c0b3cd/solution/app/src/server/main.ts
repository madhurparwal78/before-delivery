// Tally Split server: one process of possibly several sharing the same database file.
import { createServer } from "node:http";
import { useClubZone } from "./clubtime.js";
import { config } from "./config.js";
import { one } from "./db.js";
import { deleteStaleObjects } from "./documents.js";
import { serveClient } from "./http.js";
import { startMailRetries } from "./mail.js";
import { handleApi } from "./routes.js";
import { seedOnce } from "./seed.js";

const STALE_OBJECT_RETRY_MS = 30_000;

seedOnce();
useClubZone(one<{ time_zone: string }>("SELECT time_zone FROM club")!.time_zone);

const server = createServer((req, res) => {
  const pathname = (req.url ?? "/").split("?")[0]!;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    void handleApi(req, res);
  } else {
    req.resume();
    serveClient(req, res);
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log("Tally Split is listening.");
});

startMailRetries();
setInterval(() => void deleteStaleObjects().catch(() => undefined), STALE_OBJECT_RETRY_MS).unref();
