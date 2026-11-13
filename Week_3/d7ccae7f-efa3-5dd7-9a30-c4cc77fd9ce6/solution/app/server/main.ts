import { config } from "./config.js";
import { connectDatabase, pool } from "./db.js";
import { createHttpServer } from "./http.js";
import { rebuildLiveState } from "./live/rebuild.js";
import { startLive } from "./live/valkey.js";
import { endWhenIdle, lockAtDeadline } from "./rooms/commands.js";
import { startTimers } from "./rooms/timers.js";
import { routes } from "./routes.js";
import { closeAllStreams } from "./stream.js";

// With Postgres up the schema and seed are in place before the first request; with Postgres down the server listens anyway.
const DATABASE_GRACE_MS = 4000;

const logFailure = (what: string) => (error: unknown) => console.error(`${what}:`, error instanceof Error ? error.message : error);

process.on("unhandledRejection", logFailure("unhandled rejection"));
startLive({ onDown: closeAllStreams, onRecovered: () => void rebuildLiveState().catch(logFailure("leaderboard rebuild")) });

const database = connectDatabase();
await Promise.race([database, new Promise((resolve) => setTimeout(resolve, DATABASE_GRACE_MS))]);

const server = createHttpServer(routes);
server.keepAliveTimeout = 65_000;
server.listen(config.port, config.listenHost, () => console.log(`Lastbell listening on ${config.port}`));

database
  .then(() => startTimers({ lockAtDeadline, endWhenIdle }))
  .then(() => rebuildLiveState())
  .catch((error: unknown) => {
    console.error("startup failed:", error);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
