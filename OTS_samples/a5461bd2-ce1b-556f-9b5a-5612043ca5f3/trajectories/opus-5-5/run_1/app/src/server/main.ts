import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { connectContent, createPool } from "./db.js";
import { EnquiryDesk } from "./enquiries.js";
import { FileStore } from "./fileStore.js";
import { syncFiles } from "./files.js";
import { createHandler, type App } from "./server.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const store = new FileStore(config.s3);
const app: App = { config, pool, store, ready: null };

createServer(createHandler(app)).listen(config.port, "0.0.0.0", () => {
  console.log(`Vellum Orbit Studio is listening on port ${config.port}.`);
});

const content = await connectContent(pool);
app.ready = {
  content,
  desk: new EnquiryDesk(pool, content, config),
  bootstrap: {
    content,
    settings: {
      enquiryLimit: config.enquiryLimit,
      enquiryWindowSeconds: config.enquiryWindowSeconds,
      workPageSize: config.workPageSize,
    },
  },
};
syncFiles(store, content);
