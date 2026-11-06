import { config } from "./config";
import { migrate, pool, waitForDatabase } from "./db";
import { listenForEvents } from "./events";
import { createAppServer } from "./http";
import { startMailSender } from "./mail";
import { seedDatabase, uploadSeedPlans } from "./seed";
import { startDailySummaries } from "./summary";
import "./routes/session";
import "./routes/jobs";
import "./routes/people";
import "./routes/items";
import "./routes/costs";

// One process serves the API and the built front end. Postgres must be reachable within
// 60 seconds; the object store and mail server may be down, and the app still starts.

await waitForDatabase();
await migrate();
await seedDatabase();
await uploadSeedPlans();
await listenForEvents();

const server = createAppServer();
server.listen(config.port, "0.0.0.0", () => console.log(`Snaglight listening on http://0.0.0.0:${config.port}`));
startMailSender();
startDailySummaries();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
