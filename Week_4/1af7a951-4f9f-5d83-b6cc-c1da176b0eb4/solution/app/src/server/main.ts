import { createServer } from "node:http";
import { handle } from "./app.js";
import { config } from "./config.js";
import { prepareDatabase } from "./db.js";
import { retryPendingReceipts } from "./services/mail.js";

await prepareDatabase();
retryPendingReceipts();

const server = createServer((req, res) => void handle(req, res));
server.requestTimeout = 120_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Lanternfish listening on 0.0.0.0:${config.port}; outgoing mail is inspected at ${config.mail.inspectorUrl}`);
});
