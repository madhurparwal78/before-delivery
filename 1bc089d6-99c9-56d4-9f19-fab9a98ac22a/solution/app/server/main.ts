import { createServer } from "node:http";

import { startClockSync } from "./clock";
import { config } from "./config";
import { closeDb } from "./db";
import { forgetExpired } from "./guards";
import { ApiError, sendJson } from "./http";
import { flushOutbox } from "./outbox";
import { sendDueReminders } from "./reminders";
import { handleApi } from "./routes";
import { SECURITY_HEADERS, serveStatic } from "./static";

const REMINDER_EVERY_MS = 15_000;
const OUTBOX_EVERY_MS = 2_000;

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://stillhour.local").pathname;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...SECURITY_HEADERS, allow: "GET, HEAD" }).end();
      return;
    }
    await serveStatic(request, response, pathname).catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
    return;
  }
  try {
    const reply = await handleApi(request, pathname);
    sendJson(response, { ...reply, headers: { ...SECURITY_HEADERS, ...reply.headers } });
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError("internal");
    if (!(error instanceof ApiError)) console.error("request failed:", (error as Error)?.name ?? "unknown error");
    if (failure.status === 413 || failure.status === 415) {
      response.setHeader("connection", "close");
      request.resume();
    }
    sendJson(response, { status: failure.status, body: failure.body(), headers: { ...SECURITY_HEADERS, ...failure.headers } });
  }
});

/** Runs `task` every `ms`, never overlapping itself; a failure (database or mail down) waits for the next turn. */
function every(ms: number, task: () => Promise<void>) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    await task().catch(() => {});
    running = false;
  }, ms);
  return () => clearInterval(timer);
}

const stopClock = startClockSync();
const stopReminders = every(REMINDER_EVERY_MS, sendDueReminders);
const stopOutbox = every(OUTBOX_EVERY_MS, flushOutbox);
const stopForgetting = every(REMINDER_EVERY_MS, forgetExpired);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Stillhour listening on http://0.0.0.0:${config.port}`);
});

function shutdown() {
  stopClock();
  stopReminders();
  stopOutbox();
  stopForgetting();
  server.close(() => {
    closeDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
