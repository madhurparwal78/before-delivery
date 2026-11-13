import { createServer } from "node:http";
import { readConfig } from "./config.js";
import { ContentStore } from "./database.js";
import { handle } from "./routes.js";
import { loadAssets } from "./statics.js";

const config = readConfig(process.env);
const contentStore = new ContentStore(config.databaseUrl);
const assets = loadAssets();
const services = { config, contentStore, assets, modules: [...assets.keys()].filter((path) => path.endsWith(".js")) };

const server = createServer((request, response) => {
  void handle(request, response, services);
});

function shutdown(): void {
  server.closeAllConnections();
  server.close(() => void contentStore.close().finally(() => process.exit(0)));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Vireo Pace listening on port ${config.port}`);
});

void contentStore.open();
