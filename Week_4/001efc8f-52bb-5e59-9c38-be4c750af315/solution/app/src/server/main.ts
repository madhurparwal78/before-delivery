import { createServer } from "node:http";
import { config } from "./config.js";
import { startEventPoller } from "./events.js";
import { handle } from "./http.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { migrate } from "./schema.js";
import { startHealthProbes } from "./services/health.js";
import { bucketReachable } from "./services/s3.js";
import { mailReachable } from "./services/smtp.js";
import { startWorkers } from "./workers.js";

registerPeopleRoutes();
registerChannelRoutes();
registerMessageRoutes();

// The database may still be starting; wait for it without logging connection details.
for (let attempt = 1; ; attempt += 1) {
  try {
    await migrate();
    break;
  } catch {
    if (attempt === 90) {
      console.error("database unreachable; giving up");
      process.exit(1);
    }
    console.error("database not ready; retrying");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
await startHealthProbes({ storage: bucketReachable, mail: mailReachable });
startEventPoller();
startWorkers();

const server = createServer((req, res) => void handle(req, res));
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Rimewire listening on port ${config.port}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
