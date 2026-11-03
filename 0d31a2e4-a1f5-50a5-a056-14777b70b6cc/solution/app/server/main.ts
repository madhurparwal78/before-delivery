// Starts the server: one port for the API, the WebSocket and the built browser app.
import { createServer } from "node:http";
import "./chat.js";
import "./friends.js";
import "./matches.js";
import "./replay.js";
import { configureLinks } from "./auth.js";
import { loadConfig } from "./config.js";
import { connect, query } from "./db.js";
import { requestHandler } from "./http.js";
import { instanceId } from "./instance.js";
import { attachHub, onServerEvent } from "./hub.js";
import { seatQueuedParties } from "./lobby.js";
import { startDueMatches } from "./live.js";
import { configureMail } from "./mail.js";
import { seed } from "./seed.js";

const SEATING_MS = 200;
const START_CHECK_MS = 100;
const INSTANCE_BEAT_MS = 2000;

const config = loadConfig();
configureMail(config.smtpHost, config.smtpPort);
configureLinks(config.publicUrl);

const server = createServer(requestHandler(config.publicUrl));
server.on("upgrade", attachHub(config.publicUrl));
server.listen(config.port, "0.0.0.0", () => console.log(`Pratfall Cup listening on port ${config.port}`));

function every(ms: number, work: () => Promise<void>): void {
  const run = (): void => {
    const started = Date.now();
    work()
      .catch((error: unknown) => console.error(error))
      .finally(() => setTimeout(run, Math.max(0, ms - (Date.now() - started))));
  };
  run();
}

function report(work: Promise<void>): void {
  work.catch((error: unknown) => console.error(error));
}

await connect(config.databaseUrl, seed, (event) => report(onServerEvent(event)));
every(INSTANCE_BEAT_MS, async () => {
  await query("INSERT INTO server_instances (id, seen_at) VALUES ($1, clock_timestamp()) ON CONFLICT (id) DO UPDATE SET seen_at = EXCLUDED.seen_at", [instanceId]);
});
every(SEATING_MS, seatQueuedParties);
every(START_CHECK_MS, startDueMatches);
console.log("database ready");

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
