import { createServer } from "node:http";
import { config } from "./config.js";
import { connect } from "./db.js";
import { probe as probeDocuments, startRenderer } from "./documents.js";
import { describe, handleApi, route } from "./http.js";
import { probe as probePayments } from "./killbill.js";
import { probe as probeEmail } from "./mail.js";
import { startMailer } from "./notices.js";
import { seed, storeSeedCovers } from "./seed.js";
import { mark, snapshot, type Service } from "./status.js";
import { probe as probeStorage } from "./storage.js";
import { serveWeb } from "./web.js";
import { startCloseout } from "./closeout.js";
import "./people.js";
import "./campaigns.js";
import "./pledges.js";

route("GET", "/api/health", async () => ({ status: 200, json: { status: "ok" } }));
route("GET", "/api/status", async () => ({ status: 200, json: snapshot() }));

const PROBES: [Service, () => Promise<void>][] = [
  ["payments", probePayments],
  ["email", probeEmail],
  ["storage", probeStorage],
  ["documents", probeDocuments],
];

async function probeAll(): Promise<void> {
  await Promise.all(PROBES.map(async ([service, probe]) => {
    try {
      await probe();
      mark(service, "up");
    } catch {
      mark(service, "down");
    }
  }));
}

await connect();
await seed();
await probeAll();

const server = createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  // Routing reads the raw path: no dot-segment or percent-decoding normalisation can turn one path into another.
  const raw = req.url ?? "/";
  const path = raw.split("?")[0];
  const query = new URLSearchParams(raw.slice(path.length + 1));
  if (path === "/api" || path.startsWith("/api/")) void handleApi(req, res, path, query);
  else serveWeb(req, res, path);
});

server.listen(config.port, "0.0.0.0", () => console.log(`dotgain listening on port ${config.port}`));

setInterval(() => void probeAll(), 5000);
startMailer();
startRenderer();
startCloseout();
void storeSeedCovers();
setInterval(() => void storeSeedCovers().catch((error: unknown) => console.error(`seed covers: ${describe(error)}`)), 10_000);
