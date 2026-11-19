import { readFile, stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { CARS, LAYOUT_IDS, type CarClass, type LayoutId } from "../shared/model.js";
import { acceptedNext, sessionlessLanding } from "../shared/rules.js";
import {
  gradingPlayer, me, redeemLink, requestLink, sessionCookie, sessionPlayer, setUnits, startGuest, type Player,
} from "./auth.js";
import { BOARD_MODES, board, type BoardMode } from "./boards.js";
import { championship } from "./championship.js";
import { readConfig } from "./config.js";
import { connect } from "./db.js";
import { catalogue, garage, purchaseCar, purchaseUpgrade, refit, selectCar, type KeyedRequest, type StoredResponse } from "./garage.js";
import { ApiError, errors, isRecord, parseJson, readRequest, sameOrigin, sendError, sendJson, sendRaw } from "./http.js";
import { ledger } from "./ledger.js";
import { Lobbies } from "./lobby.js";
import { Hub } from "./push.js";
import { createRun, finishRun, gradingRace, replayFile, retryHeld, runBody, verifyDue } from "./runs.js";
import { ReplayStore } from "./s3.js";

const BODY_LIMIT = 65536;
const FINISH_LIMIT = 1000000;
const CLIENT_DIR = fileURLToPath(new URL("../../client/", import.meta.url));

interface Context {
  readonly req: IncomingMessage;
  readonly url: URL;
  readonly params: string[];
  readonly raw: Buffer;
  readonly body: unknown;
  readonly player: Player | null;
}

type Reply =
  | { kind: "json"; status: number; body: unknown; session?: string }
  | { kind: "stored"; response: StoredResponse }
  | { kind: "file"; bytes: Buffer; headers: Record<string, string> };

type Route = {
  readonly method: string;
  readonly pattern: RegExp;
  readonly grading?: boolean;
  readonly limit?: number;
} & (
  | { readonly auth: true; readonly handle: (ctx: Context & { player: Player }) => Promise<Reply> }
  | { readonly auth: false; readonly handle: (ctx: Context) => Promise<Reply> }
);

const json = (status: number, body: unknown, session?: string): Reply => ({ kind: "json", status, body, session });

const config = readConfig();
const db = await connect(config.databaseUrl);
const store = new ReplayStore(config.s3);
await store.ensureBucket();
const hub = new Hub(db.pool);
await hub.listen();
// The process-wide handles, opened once at start and passed to every handler.
const services = { config, db, store, hub };
export type Services = typeof services;
const lobbies = new Lobbies(services);

const keyed = (ctx: Context & { player: Player }): KeyedRequest => ({
  playerId: ctx.player.id,
  key: (ctx.req.headers["idempotency-key"] as string | undefined) || undefined,
  path: ctx.url.pathname,
  raw: ctx.raw,
  body: ctx.body,
});

const routes: Route[] = [
  { method: "GET", pattern: /^\/v1\/status$/, auth: false,
    handle: async () => json(200, { replayStorage: (await store.available()) ? "ok" : "unavailable" }) },
  { method: "POST", pattern: /^\/v1\/guests$/, auth: false,
    handle: async (ctx) => {
      const started = await startGuest(services, ctx.body);
      return json(201, started.body, started.token);
    } },
  { method: "GET", pattern: /^\/v1\/me$/, auth: true, handle: async (ctx) => json(200, await me(db, ctx.player)) },
  { method: "PATCH", pattern: /^\/v1\/me$/, auth: true, handle: async (ctx) => json(200, await setUnits(services, ctx.player, ctx.body)) },
  { method: "GET", pattern: /^\/v1\/cars$/, auth: false,
    handle: async () => json(200, catalogue()) },
  { method: "GET", pattern: /^\/v1\/garage$/, auth: true, handle: async (ctx) => json(200, await garage(db, ctx.player.id)) },
  { method: "PATCH", pattern: /^\/v1\/garage$/, auth: true, handle: async (ctx) => json(200, await selectCar(services, ctx.player.id, ctx.body)) },
  { method: "POST", pattern: /^\/v1\/garage\/cars$/, auth: true,
    handle: async (ctx) => ({ kind: "stored", response: await purchaseCar(services, keyed(ctx)) }) },
  { method: "POST", pattern: /^\/v1\/garage\/cars\/([^/]+)\/upgrades\/([^/]+)$/, auth: true,
    handle: async (ctx) => ({ kind: "stored", response: await purchaseUpgrade(services, keyed(ctx), ctx.params[0], ctx.params[1]) }) },
  { method: "POST", pattern: /^\/v1\/garage\/cars\/([^/]+)\/refits\/([^/]+)$/, auth: true,
    handle: async (ctx) => ({ kind: "stored", response: await refit(services, keyed(ctx), ctx.params[0], ctx.params[1]) }) },
  { method: "GET", pattern: /^\/v1\/ledger$/, auth: true, handle: async (ctx) => json(200, await ledger(db, ctx.player.id)) },
  { method: "POST", pattern: /^\/v1\/runs$/, auth: true, handle: async (ctx) => json(201, await createRun(services, ctx.player.id, ctx.body)) },
  { method: "POST", pattern: /^\/v1\/runs\/([^/]+)\/finish$/, auth: true, limit: FINISH_LIMIT,
    handle: async (ctx) => json(202, await finishRun(services, ctx.player.id, ctx.params[0], ctx.raw)) },
  { method: "GET", pattern: /^\/v1\/runs\/([^/]+)$/, auth: true, handle: async (ctx) => json(200, await runBody(services, ctx.player.id, ctx.params[0])) },
  { method: "GET", pattern: /^\/v1\/runs\/([^/]+)\/replay$/, auth: true,
    handle: async (ctx) => {
      const { bytes, digest } = await replayFile(services, ctx.player.id, ctx.params[0]);
      return { kind: "file", bytes, headers: {
        "Content-Type": "application/json",
        "X-Replay-SHA256": digest,
        "Content-Disposition": `attachment; filename="kerbline-${ctx.params[0]}.json"`,
      } };
    } },
  { method: "GET", pattern: /^\/v1\/boards$/, auth: true,
    handle: async (ctx) => {
      const layoutId = ctx.url.searchParams.get("layoutId");
      const mode = ctx.url.searchParams.get("mode");
      const carClass = ctx.url.searchParams.get("class");
      const fields: Record<string, string> = {};
      if (!LAYOUT_IDS.includes(layoutId as LayoutId)) fields.layoutId = "Unknown layout.";
      if (!BOARD_MODES.includes(mode as BoardMode)) fields.mode = "Mode is time-trial, circuit or drift.";
      if (!CARS.some((car) => car.class === carClass)) fields.class = "Class is D, C or B.";
      if (Object.keys(fields).length) throw errors.invalid(fields);
      return json(200, await board(db, layoutId as LayoutId, mode as BoardMode, carClass as CarClass, ctx.player.id));
    } },
  { method: "GET", pattern: /^\/v1\/championship$/, auth: true, handle: async (ctx) => json(200, await championship(db, ctx.player.id)) },
  { method: "POST", pattern: /^\/v1\/lobbies$/, auth: true,
    handle: async (ctx) => json(201, await lobbies.create(ctx.player.id, ctx.player.name, isRecord(ctx.body) ? ctx.body.aiCount : undefined)) },
  { method: "GET", pattern: /^\/v1\/lobbies\/([^/]+)$/, auth: true, handle: async (ctx) => json(200, await lobbies.read(ctx.params[0])) },
  { method: "POST", pattern: /^\/v1\/lobbies\/([^/]+)\/join$/, auth: true,
    handle: async (ctx) => json(200, await lobbies.join(ctx.params[0], ctx.player.id, ctx.player.name)) },
  { method: "POST", pattern: /^\/v1\/lobbies\/([^/]+)\/ready$/, auth: true,
    handle: async (ctx) => json(200, await lobbies.ready(ctx.params[0], ctx.player.id, isRecord(ctx.body) ? ctx.body.ready : undefined)) },
  { method: "POST", pattern: /^\/v1\/auth\/links$/, auth: false,
    handle: async (ctx) => json(202, await requestLink(services, ctx.body)) },
  { method: "POST", pattern: /^\/v1\/auth\/redeem$/, auth: false,
    handle: async (ctx) => {
      const redeemed = await redeemLink(services, ctx.player, ctx.body);
      return json(200, redeemed.body, redeemed.token);
    } },
  { method: "POST", pattern: /^\/v1\/grading\/players$/, auth: false, grading: true,
    handle: async (ctx) => {
      const created = await gradingPlayer(services, ctx.body);
      return json(201, created.body, created.token);
    } },
  { method: "POST", pattern: /^\/v1\/grading\/races$/, auth: true, grading: true,
    handle: async (ctx) => json(202, await gradingRace(services, ctx.player.id, ctx.body)) },
];

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const matched = routes.map((route) => ({ route, match: route.pattern.exec(url.pathname) }))
    .find(({ route, match }) => match && route.method === req.method);
  if (!matched?.match || (matched.route.grading && !config.gradingRoutes)) throw errors.notFound();
  const { route, match } = matched;
  const raw = await readRequest(req, route.limit ?? BODY_LIMIT);
  const player = await sessionPlayer(db, req);
  const ctx: Context = {
    req, url, raw, player,
    params: match.slice(1).map((part) => decodeURIComponent(part)),
    body: route.limit === FINISH_LIMIT ? null : parseJson(raw),
  };
  let reply: Reply;
  if (route.auth) {
    if (!player) throw errors.unauthenticated();
    reply = await route.handle({ ...ctx, player });
  } else {
    reply = await route.handle(ctx);
  }
  if (reply.kind === "stored") {
    sendRaw(res, reply.response.status, reply.response.body);
  } else if (reply.kind === "file") {
    res.writeHead(200, { ...reply.headers, "Content-Length": String(reply.bytes.length), "Cache-Control": "no-store" });
    res.end(reply.bytes);
  } else {
    sendJson(res, reply.status, reply.body, reply.session ? { "Set-Cookie": sessionCookie(reply.session) } : {});
  }
}

const PAGES = [/^\/$/, /^\/garage$/, /^\/garage\/dealer$/, /^\/garage\/coins$/, /^\/race$/, /^\/runs\/[^/]+$/, /^\/boards$/,
  /^\/championship$/, /^\/lobby\/new$/, /^\/lobby\/[^/]+$/, /^\/sign-in$/, /^\/sign-in\/[^/]+$/];
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2",
  ".woff": "font/woff", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8",
};

async function sendFile(res: ServerResponse, path: string, cache: string): Promise<void> {
  const bytes = await readFile(path);
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Content-Length": String(bytes.length), "Cache-Control": cache });
  res.end(bytes);
}

async function page(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.pathname.startsWith("/assets/")) {
    const path = normalize(join(CLIENT_DIR, url.pathname));
    if (path.startsWith(join(CLIENT_DIR, "assets")) && (await stat(path).catch(() => null))?.isFile()) {
      await sendFile(res, path, "public, max-age=31536000, immutable");
      return;
    }
    throw errors.notFound();
  }
  if (!PAGES.some((pattern) => pattern.test(url.pathname))) throw errors.notFound();
  const player = await sessionPlayer(db, req);
  const redirect = (location: string) => {
    res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
    res.end();
  };
  const next = acceptedNext(url.searchParams.get("next"));
  if (url.pathname === "/" && player) return redirect(next ?? "/garage");
  if (!player && url.pathname !== "/" && !url.pathname.startsWith("/sign-in")) return redirect(sessionlessLanding(url.pathname));
  await sendFile(res, join(CLIENT_DIR, "index.html"), "no-store");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", config.publicUrl);
  const work = url.pathname === "/health" ? Promise.resolve(sendJson(res, 200, { status: "ok" }))
    : url.pathname.startsWith("/v1/") ? api(req, res, url) : page(req, res, url);
  work.catch((error: unknown) => {
    if (res.headersSent) return;
    if (error instanceof ApiError) sendError(res, error);
    else {
      console.error(error);
      sendError(res, errors.internal());
    }
  });
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: BODY_LIMIT });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", config.publicUrl);
  const refuse = (status: string) => {
    socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  };
  if (url.pathname !== "/v1/ws") return refuse("404 Not Found");
  if (req.headers.origin && !sameOrigin(req.headers.origin, req.headers.host)) return refuse("403 Forbidden");
  void sessionPlayer(db, req).then((player) => {
    if (!player) return refuse("401 Unauthorized");
    sockets.handleUpgrade(req, socket, head, (ws) => {
      hub.attach(player.id, ws);
      ws.on("message", (data) => {
        let message: unknown;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (!isRecord(message)) return;
        if (message.type === "lobby") lobbies.subscribe(ws, player.id, message.lobbyId);
        if (message.type === "keys") lobbies.keys(ws, player.id, message.lobbyId, message);
      });
      const alive = setInterval(() => ws.ping(), 15000);
      ws.on("close", () => clearInterval(alive));
    });
  });
});

let verifying = false;
setInterval(() => {
  if (verifying) return;
  verifying = true;
  verifyDue(services).catch((error: unknown) => console.error(error)).finally(() => { verifying = false; });
}, 200);
let retrying = false;
setInterval(() => {
  if (retrying) return;
  retrying = true;
  retryHeld(services).catch((error: unknown) => console.error(error)).finally(() => { retrying = false; });
}, 2000);

server.listen(config.port, "0.0.0.0", () => console.log(`Kerbline listening on ${config.port}`));
process.on("SIGTERM", () => process.exit(0));
