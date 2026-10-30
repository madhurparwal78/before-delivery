import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { createServer } from "./http.js";
import { probe as probeBilling } from "./killbill.js";
import { probe as probeMail } from "./mail.js";
import { watchReminders } from "./reminders.js";
import { storeSeedFiles } from "./routes/documents.js";
import { applySchemaAndSeed } from "./schema.js";
import { isUp, watchServices } from "./services.js";
import { probe as probeFiles } from "./storage.js";
import "./routes/bookings.js";
import "./routes/holds.js";
import "./routes/invoices.js";
import "./routes/kitchens.js";
import "./routes/packs.js";
import "./routes/reports.js";
import "./routes/series.js";
import "./routes/session.js";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

await applySchemaAndSeed(new Date());

const server = createServer(clientRoot);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Pilotlight listening on port ${config.port}`);
});

watchServices({ billing: probeBilling, files: probeFiles, mail: probeMail }, () => {
  if (isUp("files")) storeSeedFiles().catch(() => undefined);
});
watchReminders();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => process.exit(0));
}
