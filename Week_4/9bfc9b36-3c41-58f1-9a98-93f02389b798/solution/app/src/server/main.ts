import { config } from "./config.js";
import { superviseForever } from "./lifecycle.js";
import { createServer } from "./server.js";

process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[boltrope] unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
});

const server = createServer();
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => {
  process.stdout.write(`[boltrope] listening on ${config.port}\n`);
});
superviseForever();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
