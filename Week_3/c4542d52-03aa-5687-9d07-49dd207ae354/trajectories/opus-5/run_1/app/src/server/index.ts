import { connectWithRetry } from "./db.js";
import { resumePolling } from "./flows/exercise.js";
import { startClock } from "./live/hub.js";
import { startServer } from "./http/server.js";
import { applySchemaAndSeed } from "./seed.js";
import { startScheduler } from "./scheduler.js";

startServer();
startClock();
startScheduler();

void connectWithRetry(async () => {
  await applySchemaAndSeed();
}).then(async () => {
  await resumePolling();
});
