import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { sessionFor } from "./accounts.js";
import { ownerOfBullet, readOutline } from "./commit.js";
import { config } from "./config.js";
import { migrate, waitForDatabase } from "./db.js";
import {
  ApiError, cookieValue, isJson, notFound, parseObject, readBody, send, TooLarge, unauthenticated, type Context, type Reply,
} from "./http.js";
import { accept, startLive } from "./live.js";
import { servePage } from "./pages.js";
import { routes } from "./routes.js";
import { seedIfAbsent } from "./seed.js";
import { startSweep } from "./sweep.js";

let ready = false;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function keyMatches(req: IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers["x-grading-key"] ?? ""));
  const wanted = Buffer.from(config.gradingKey ?? "");
  return config.gradingKey !== undefined && given.length === wanted.length && timingSafeEqual(given, wanted);
}

function reply(res: ServerResponse, result: Reply, cookies: string[]): void {
  const headers: Record<string, string | string[]> = { ...(result.headers ?? {}) };
  if (cookies.length > 0) headers["Set-Cookie"] = cookies;
  if (result.status === 204) {
    res.writeHead(204, { "Cache-Control": "no-store", ...headers });
    res.end();
  } else if (result.raw !== undefined) {
    res.writeHead(result.status, { "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(result.raw), ...headers });
    res.end(result.raw);
  } else {
    send(res, result.status, result.body, headers as Record<string, string>);
  }
}

/** A path segment the database could never hold (bad escape, NUL) names nothing: answer 404 before any lookup. */
function decodeParam(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw notFound();
  }
  if (value.includes("\0")) throw notFound();
  return value;
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const matched = routes.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
  if (matched === undefined) return send(res, 404, { error: "not_found" });
  if (matched.gradingKey && !keyMatches(req)) return send(res, 404, { error: "not_found" });
  if (!ready) return send(res, 503, { status: "starting" });
  const cookies: string[] = [];
  try {
    let raw: Buffer = Buffer.alloc(0);
    if (WRITES.has(method)) {
      try {
        raw = await readBody(req, matched.limit);
      } catch (error) {
        if (error instanceof TooLarge) {
          res.setHeader("Connection", "close");
          return send(res, 413, { error: "too_large" });
        }
        throw error;
      }
      if (raw.length > 0 && !isJson(req)) return send(res, 415, { error: "unsupported_media_type" });
    }
    const user = await sessionFor(cookieValue(req, "twig_session"));
    if (matched.auth && user === null) throw unauthenticated();
    const params: Record<string, string> = {};
    const found = matched.pattern.exec(url.pathname);
    matched.names.forEach((name, index) => { params[name] = decodeParam(found?.[index + 1] ?? ""); });
    const context: Context = {
      req, res, params, query: url.searchParams, user, body: parseObject(raw),
      setCookie: (value) => { cookies.push(value); },
    };
    reply(res, await matched.handler(context), cookies);
  } catch (error) {
    if (error instanceof ApiError) return send(res, error.status, error.body);
    console.error(error);
    send(res, 500, { error: "internal_error" });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://twigline.local");
  const run = url.pathname.startsWith("/api/") ? api(req, res, url) : servePage(req, res, url);
  run.catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "internal_error" });
  });
});

function refuse(socket: Duplex, status: number, error: string): void {
  const body = JSON.stringify({ error });
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Not Found"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  socket.destroy();
}

async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(req.url ?? "/", "http://twigline.local");
  if (url.pathname !== "/api/live" || !ready) return refuse(socket, 404, "not_found");
  const origin = req.headers.origin;
  if (origin !== undefined && new URL(origin).host !== req.headers.host) return refuse(socket, 401, "unauthenticated");
  const actor = await sessionFor(cookieValue(req, "twig_session"));
  if (actor === null) return refuse(socket, 401, "unauthenticated");
  try {
    const root = url.searchParams.get("root");
    const ownerId = root === null || root === "" || root === "home" ? actor.accountId : await ownerOfBullet(root);
    const { scope, seq } = await readOutline(actor, ownerId);
    const focus = root === null || root === "" || root === "home" ? null : root;
    if (focus !== null && !scope.canSee(focus)) throw notFound();
    const since = Number(url.searchParams.get("since") ?? seq);
    accept(req, socket, head, {
      accountId: actor.accountId, ownerId, since: Number.isInteger(since) && since >= 0 ? since : seq,
      shareRoot: focus === null ? null : scope.shown?.get(focus)?.root ?? null,
    });
  } catch {
    refuse(socket, 404, "not_found");
  }
}

server.on("upgrade", (req, socket, head) => {
  void upgrade(req, socket, head).catch(() => socket.destroy());
});

server.listen(config.port, "0.0.0.0");

void (async () => {
  await waitForDatabase();
  await migrate();
  await seedIfAbsent();
  startLive();
  startSweep();
  ready = true;
})();

