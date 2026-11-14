import { createServer } from "node:http";
import { readConfig } from "./config";
import { connect, loadCatalog, prepare } from "./db";
import { FileStore } from "./file-store";
import { App } from "./app";
import { keepFilesStored } from "./files/store-files";
import { sleep } from "./time";

const RETRY_MS = 5000;

const config = readConfig();
const db = connect(config);
const files = new FileStore(config.s3);
const app = new App(config, db, files);

createServer((request, response) => void app.handle(request, response)).listen(config.port, "0.0.0.0");

/** Postgres may come up after the app: keep trying until the schema and the starting content are in place. */
async function start(): Promise<void> {
  for (;;) {
    try {
      await prepare(db);
      app.ready = true;
      break;
    } catch {
      console.error("Postgres is not ready; trying again");
      await sleep(RETRY_MS);
    }
  }
  await keepFilesStored(files, () => loadCatalog(db), RETRY_MS);
}

void start();
