// Boot: listen at once, answer health with 503 until the schema is ready, then start the intake
// pull, the rollover check and the service monitor.

import { createServer } from "node:http";
import { config } from "./config.js";
import { useCycles } from "./cycles.js";
import { migrate } from "./db.js";
import { listenForChanges, openStream } from "./events.js";
import { handle, route, stream } from "./http.js";
import { intakeReachable, pull } from "./intake.js";
import { rollover } from "./rollover.js";
import { monitor } from "./status.js";
import { storageReachable } from "./storage.js";

let ready = false;

route("GET", "/api/health", async () => (ready ? { status: 200, body: { status: "ok" } } : { status: 503, body: { status: "starting" } }));
stream("/api/events", openStream);

createServer((req, res) => void handle(req, res)).listen(config.port, "0.0.0.0", () => {
  console.log(`Promptside listening on 0.0.0.0:${config.port}`);
});

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const every = (ms: number, job: () => Promise<void>, name: string): void => {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    job()
      .catch((error: Error) => console.error(`${name} failed:`, error.message))
      .finally(() => {
        running = false;
      });
  }, ms);
};

const boot = async (): Promise<void> => {
  const firstCheck = monitor({ intake: intakeReachable, plot_storage: storageReachable });
  for (;;) {
    try {
      const { anchor, windows } = await migrate();
      useCycles(anchor, windows);
      break;
    } catch (error) {
      console.error("waiting for Postgres:", (error as Error).message);
      await pause(1000);
    }
  }
  await listenForChanges();
  await firstCheck;
  await pull().catch((error: Error) => console.error("start-up pull failed:", error.message));
  await rollover().catch((error: Error) => console.error("start-up rollover failed:", error.message));
  ready = true;
  every(1500, pull, "intake pull");
  every(1000, rollover, "rollover");
};

void boot();
