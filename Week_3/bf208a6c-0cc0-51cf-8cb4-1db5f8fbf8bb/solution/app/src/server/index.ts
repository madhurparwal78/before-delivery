import { server } from "./app";
import { checkServices, kickPushes, kickRemoval, startLoops } from "./background";
import { config } from "./config";
import { connectAndMigrate } from "./db";
import { seedDemo } from "./seed";

await connectAndMigrate();
await seedDemo();
await checkServices();
startLoops();
kickPushes();
kickRemoval();
server.listen(config.port, "0.0.0.0", () => console.log(`Pinsheet listening on ${config.port}`));
