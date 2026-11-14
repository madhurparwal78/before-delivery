import http from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prepareDatabase } from "./db.js";
import { handleUpgrade, startLive } from "./live.js";
import { startOutbox } from "./mail.js";
import { expireLapsedResponses } from "./respond.js";

const EXPIRY_SWEEP_MS = 5000;

process.on("unhandledRejection", (reason) => console.error("Unhandled rejection", reason));

const ready = prepareDatabase();
const server = http.createServer(createApp(ready));
server.on("upgrade", handleUpgrade);
server.listen(config.port, "0.0.0.0");

await ready;
startLive();
startOutbox();
setInterval(() => {
  expireLapsedResponses().catch(() => undefined);
}, EXPIRY_SWEEP_MS);
