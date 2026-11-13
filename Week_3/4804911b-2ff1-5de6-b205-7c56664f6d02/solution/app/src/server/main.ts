import { createServer } from "node:http";
import { config } from "./config.js";
import { markReady } from "./db.js";
import { dispatchApi, errorReply } from "./dispatch.js";
import { dispatchPage } from "./pages.js";
import { send } from "./http.js";
import { startBackground } from "./background.js";
import { migrateAndSeed } from "./seed.js";
import "./routes_public.js";
import "./routes_session.js";
import "./routes_editor.js";
import "./routes_stockist.js";

process.on("uncaughtException", (error) => console.error("uncaught", error));
process.on("unhandledRejection", (error) => console.error("unhandled", error));

// A normal start never answers "unavailable": requests wait for the first boot attempt, but not for a hanging Postgres.
let firstAttemptDone = (): void => undefined;
const firstAttempt = new Promise<void>((resolve) => (firstAttemptDone = resolve));
const booted = Promise.race([firstAttempt, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://interval.local");
  const work = booted.then(() => (url.pathname.startsWith("/api/") ? dispatchApi(req, res, url) : dispatchPage(req, res, url.pathname)));
  work.catch((error: unknown) => {
    if (!res.headersSent) send(res, errorReply(error));
    else res.destroy();
  });
});
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => console.log(`interval listening on ${config.port}`));

// The server listens at once; the record comes up whenever Postgres is reachable, and again after any outage.
async function bringUp(): Promise<void> {
  for (;;) {
    try {
      await migrateAndSeed();
      markReady();
      firstAttemptDone();
      void startBackground();
      return;
    } catch (error) {
      firstAttemptDone();
      console.error("waiting for the record", (error as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
void bringUp();
