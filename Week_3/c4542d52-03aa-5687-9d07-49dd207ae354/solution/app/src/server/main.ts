import { config } from "./config.js";
import { connectDatabase } from "./db.js";
import { createHttpServer } from "./http.js";
import { startLive } from "./live.js";
import { registerRoutes } from "./routes.js";
import { startScheduler } from "./scheduler.js";
import { seedRegister } from "./seed.js";

registerRoutes();
const server = createHttpServer();
// No host argument: Node listens on every interface.
server.listen(config.port);

void connectDatabase(seedRegister).then(async () => {
  await startLive();
  startScheduler();
});
