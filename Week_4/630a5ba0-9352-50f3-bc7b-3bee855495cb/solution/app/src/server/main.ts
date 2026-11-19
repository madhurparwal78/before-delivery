import { createServer } from "node:http";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { dispatch, loadAssets } from "./http.js";
import { startWorker } from "./outbox.js";
import { seed } from "./seed.js";
import "./routes/account.js";
import "./routes/tasks.js";
import "./routes/sessions.js";
import "./routes/routines.js";
import "./routes/feed.js";
import "./routes/shutdown.js";
import "./routes/workspace.js";
import "./routes/billing.js";
import "./imports/routes.js";

async function prepareDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(seed);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
      if (attempt >= 60) {
        console.error(`Database unreachable after ${attempt} attempts (${code}).`);
        process.exit(1);
      }
      console.error(`Database not ready (attempt ${attempt}, ${code}); retrying.`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

await loadAssets();
await prepareDatabase();
startWorker();
createServer((req, res) => void dispatch(req, res)).listen(config.port, "0.0.0.0", () => {
  console.log(`Tidemark Daybook listening on port ${config.port}`);
});
