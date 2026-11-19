import { config } from "./config.js";
import { waitForDatabase } from "./db.js";
import { createServer } from "./server.js";

await waitForDatabase();
createServer().listen(config.port, "0.0.0.0");
