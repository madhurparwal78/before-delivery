// Parcel Moon server: one origin for the game, the console, the claim page, postcard pages and the API.
import http from "node:http";
import { config } from "./config";
import { connectDatabase, pool } from "./db";
import { dispatch } from "./http";
import { promoteDue } from "./missions";
import { servePage } from "./pages";
import { pruneStreams } from "./presence";
import "./routes-auth";
import "./routes-play";
import { sweepStore } from "./routes-postcards";
import "./routes-staff";
import { sessionOf } from "./sessions";

const server = http.createServer((req, res) => {
  void dispatch(req, res, async (ctx) => (await sessionOf(ctx, pool)) !== null, servePage);
});
server.keepAliveTimeout = 65_000;

/** Runs a background chore on a fixed beat; a failed round is retried on the next beat. */
function every(ms: number, chore: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    chore()
      .catch(() => undefined)
      .finally(() => (running = false));
  }, ms).unref();
}

connectDatabase(() => {
  every(250, promoteDue);
  every(10_000, () => pruneStreams(pool));
  every(20_000, sweepStore);
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Parcel Moon listening on ${config.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
