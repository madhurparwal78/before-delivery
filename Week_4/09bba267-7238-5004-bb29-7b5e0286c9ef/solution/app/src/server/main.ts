// Halyard Seatwise server: binds at once (health answers "starting"), migrates when Postgres answers, then serves.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { config } from "./config.js";
import { pool } from "./db.js";
import {
  checkOrigin, cookies, fail, HttpError, identifyBuyer, OWNER_COOKIE, parseBody, sendAsset, sendJson, sendPage, type Context,
} from "./http.js";
import { listen, openSocket } from "./live.js";
import { deliverQueued } from "./outbox.js";
import { route } from "./routes.js";
import { migrate } from "./schema.js";
import { sweep } from "./sweep.js";

let ready = false;

const PAGE = /^\/(?:|tickets|owner|owner\/new|owner\/orders|owner\/outbox|p\/[a-z0-9-]+|offers\/[A-Za-z0-9_-]+)$/;

/** Unknown performances and offers get the not-found page with a 404. */
async function pageExists(path: string): Promise<boolean> {
  if (!PAGE.test(path)) return false;
  const [, kind, id] = /^\/(p|offers)\/(.+)$/.exec(path) ?? [];
  if (!kind || !ready) return true;
  const table = kind === "p" ? "SELECT 1 FROM performances WHERE id = $1" : "SELECT 1 FROM offers WHERE token = $1";
  return Boolean((await pool.query(table, [id])).rowCount);
}

async function api(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams, setCookies: string[]): Promise<void> {
  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? {} : await parseBody(req);
  checkOrigin(req);
  if (path === "/api/health") {
    // A status report, not an API error: the brief fixes these two bodies, 200 {"status":"ok"} once the schema is
    // ready and 503 {"status":"starting"} before. Every error answer goes through HttpError's {"error":...} shape.
    sendJson(res, ready ? 200 : 503, { status: ready ? "ok" : "starting" });
    return;
  }
  if (!ready) throw fail(503, "starting");
  const jar = cookies(req);
  const buyer = await identifyBuyer(jar);
  if (buyer.cookie) setCookies.push(buyer.cookie);
  const now = new Date();
  await sweep(now);
  const key = req.headers["idempotency-key"];
  const ctx: Context = {
    method, path, query, body, now,
    buyerId: buyer.buyerId,
    ownerToken: jar.get(OWNER_COOKIE) ?? null,
    idempotencyKey: typeof key === "string" ? key : null,
  };
  const reply = await route(ctx);
  sendJson(res, reply.status, reply.body, [...setCookies, ...(reply.cookies ?? [])]);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://seatwise.invalid");
  const setCookies: string[] = [];
  try {
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url.pathname, url.searchParams, setCookies);
      return;
    }
    checkOrigin(req);
    if (await sendAsset(res, url.pathname)) return;
    const exists = await pageExists(url.pathname);
    if (exists && ready) {
      const buyer = await identifyBuyer(cookies(req));
      if (buyer.cookie) setCookies.push(buyer.cookie);
    }
    await sendPage(res, exists ? 200 : 404, setCookies);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, error.body, setCookies);
      if (error.status === 413) req.resume();
      return;
    }
    console.error("request failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    else res.end();
  }
}

/** `GET /api/events` with `Upgrade: websocket`: the live channel, same-origin only. */
async function upgrade(req: IncomingMessage, socket: Duplex): Promise<void> {
  const url = new URL(req.url ?? "/", "http://seatwise.invalid");
  const key = req.headers["sec-websocket-key"];
  const refuse = (status: string): void => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  if (url.pathname !== "/api/events" || typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") {
    refuse("404 Not Found");
    return;
  }
  try {
    checkOrigin(req);
  } catch {
    refuse("403 Forbidden");
    return;
  }
  if (!ready) {
    refuse("503 Service Unavailable");
    return;
  }
  const buyer = await identifyBuyer(cookies(req));
  openSocket(socket, key, buyer.buyerId, url.searchParams.get("offer"), buyer.cookie ? [buyer.cookie] : []);
}

async function boot(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      break;
    } catch (error) {
      console.error("waiting for Postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  ready = true;
  listen();
  let sweeping = false;
  setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    sweep(new Date()).catch((error: Error) => console.error("sweep failed:", error.message)).finally(() => { sweeping = false; });
    void deliverQueued().catch((error: Error) => console.error("outbox delivery failed:", error.message));
  }, 1000);
}

const server = createServer((req, res) => void handle(req, res));
server.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
  socket.on("error", () => socket.destroy());
  upgrade(req, socket).catch(() => socket.destroy());
});
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Halyard Seatwise listening on port ${config.port}`);
});
void boot();

