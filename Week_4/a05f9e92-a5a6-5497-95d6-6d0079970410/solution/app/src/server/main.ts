import { createServer } from "node:http";
import { sessionFor } from "./auth.js";
import { loadOffset } from "./clock.js";
import { connection, settings } from "./config.js";
import { applySchema, connectWithRetry, query, transaction } from "./db.js";
import { Env } from "./env.js";
import { retryOutageFailures } from "./exports.js";
import { flushQueued } from "./files.js";
import { dispatch } from "./http.js";
import { attach } from "./live.js";
import { findRecord } from "./records.js";
import { tick } from "./scheduler.js";
import { seedIfEmpty } from "./seed.js";
import { onRecovery, probe } from "./storage.js";
import "./routes/core.js";
import "./routes/records.js";
import "./routes/domain.js";
import "./routes/config.js";
import "./grading.js";

let ready = false;

const server = createServer((req, res) => {
  if (!ready && (req.url ?? "").startsWith("/api/")) {
    const body = JSON.stringify({ status: "starting" });
    res.writeHead(503, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  void dispatch(req, res);
});

attach(
  server,
  async (request) => {
    const header = request.headers.cookie ?? "";
    const token = header.split(";").map((p) => p.trim()).find((p) => p.startsWith("switchyard_session="));
    const session = await sessionFor(token ? decodeURIComponent(token.slice("switchyard_session=".length)) : null);
    return session ? session.user : null;
  },
  async (user, topic) => {
    const [family, id] = topic.split(/:(.*)/s) as [string, string | undefined];
    const desk = user.roles.includes("operator") || user.roles.includes("technician");
    switch (family) {
      case "record":
      case "sla":
      case "presence":
      case "major":
      case "votes":
        return transaction(async (tx) => {
          const env = await Env.create(tx, { user, actor: user.username, actingFor: null });
          const rec = id ? await findRecord(tx, id) : null;
          return !!rec && (await env.access()).canRead(rec);
        });
      case "list":
      case "approvals":
      case "inbox":
      case "session":
      case "storage":
        return true;
      case "run":
        return desk;
      case "dashboard":
        return desk || user.roles.includes("manager");
      case "export": {
        const row = (await query("SELECT owner FROM exports WHERE id = $1", [Number(id)]))[0];
        return !!row && (row.owner === user.username || user.roles.includes("operator"));
      }
      default:
        return false;
    }
  },
);

function scheduleProbe(): void {
  setTimeout(() => {
    void probe().finally(scheduleProbe);
  }, settings.STORAGE_RETRY_SECONDS * 1000).unref();
}

async function start(): Promise<void> {
  server.listen(connection.port, "0.0.0.0");
  await connectWithRetry(() => undefined);
  await applySchema();
  const offset = (await query("SELECT value FROM meta WHERE key = 'clock_offset'"))[0];
  if (offset) loadOffset(Number(offset.value));
  await seedIfEmpty();
  onRecovery(flushQueued);
  onRecovery(retryOutageFailures);
  await probe();
  scheduleProbe();
  setInterval(() => void tick().catch((error) => process.stderr.write(`tick failed: ${String(error)}\n`)), 1000).unref();
  ready = true;
}

process.on("unhandledRejection", (error) => process.stderr.write(`unhandled rejection: ${String(error)}\n`));
process.on("uncaughtException", (error) => process.stderr.write(`uncaught exception: ${String(error)}\n`));
start().catch((error) => {
  process.stderr.write(`startup failed: ${String(error)}\n`);
  process.exit(1);
});
