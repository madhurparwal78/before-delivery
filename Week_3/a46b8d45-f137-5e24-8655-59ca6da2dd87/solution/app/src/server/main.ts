import { config } from "./config";
import { ensureSchema } from "./db";
import { startServer } from "./http";
import { startNoticeWorker } from "./notices";

process.on("uncaughtException", (error) => process.stderr.write(`uncaught: ${error.stack ?? error.message}\n`));
process.on("unhandledRejection", (reason) => process.stderr.write(`unhandled: ${String(reason)}\n`));

const server = startServer(config.port);
process.stdout.write(`Fittings Desk listening on 0.0.0.0:${config.port}\n`);

/** The desk serves whether or not Postgres answers; the schema is applied as soon as it does. */
function applySchemaWhenPossible(): void {
  ensureSchema().catch(() => setTimeout(applySchemaWhenPossible, 3000).unref());
}
applySchemaWhenPossible();
startNoticeWorker();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
