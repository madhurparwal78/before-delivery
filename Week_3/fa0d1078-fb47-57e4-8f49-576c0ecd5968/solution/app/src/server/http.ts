import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { ClientConfig, Player } from "../shared/protocol";
import { playerForSession } from "./auth";
import { config } from "./config";
import { ApiError } from "./errors";
import { ownsGame } from "./games";
import { acceptSocket } from "./live";
import { routes, type Call, type Reply } from "./routes";

const BODY_LIMIT_BYTES = 1_000_000;
const DRAIN_LIMIT_BYTES = 5 * BODY_LIMIT_BYTES;
const SESSION_COOKIE = "seam_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;
const CLIENT_ROOT = fileURLToPath(new URL("./client/", import.meta.url));

const PAGES = [
  /^\/$/,
  /^\/(signin|signup|reset|daily|leaderboard|duel|profile)$/,
  /^\/(verify|reset|leaderboard|duel|play)\/[^/]+$/,
];
const ASSET = /^\/(app\.js|app\.css|fonts\/[a-z0-9-]+\.woff2)$/;
const ASSET_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
};
const PLAY_PAGE = /^\/play\/([^/]+)$/;

const clientConfig: ClientConfig = {
  mistakeLimit: config.rules.mistakeLimit,
  hintLimit: config.rules.hintLimit,
  dailyStart: config.dailyStart,
};

let indexHtml: Promise<string> | null = null;

/** The same bytes for every request: the built page with this instance's limits written in. */
function page(): Promise<string> {
  indexHtml ??= readFile(`${CLIENT_ROOT}index.html`, "utf8").then((html) => html.replace("__SEAM_CONFIG__", JSON.stringify(clientConfig)));
  return indexHtml;
}

function cookieOf(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function originOf(request: IncomingMessage): string {
  const origin = request.headers.origin;
  return origin && origin !== "null" ? origin : `http://${request.headers.host}`;
}

async function sessionPlayer(request: IncomingMessage): Promise<Player | null> {
  const token = cookieOf(request, SESSION_COOKIE);
  return token ? playerForSession(token) : null;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    received += (chunk as Buffer).length;
    if (received > DRAIN_LIMIT_BYTES) request.destroy();
    else if (received <= BODY_LIMIT_BYTES) chunks.push(chunk as Buffer);
  }
  if (received > BODY_LIMIT_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE");
  if (received === 0) return {};
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
  }
}

function send(response: ServerResponse, status: number, headers: Record<string, string | string[]>, body?: string | Buffer): void {
  response.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...headers,
  });
  response.end(body);
}

function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store" };
  if (reply.session !== undefined) {
    headers["Set-Cookie"] = `${SESSION_COOKIE}=${reply.session ?? ""}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${reply.session ? SESSION_MAX_AGE_SECONDS : 0}`;
  }
  if (reply.body === undefined) return send(response, reply.status, headers);
  send(response, reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(reply.body));
}

function sendError(response: ServerResponse, error: unknown): void {
  const failure = error instanceof ApiError ? error : new ApiError("INTERNAL");
  if (!(error instanceof ApiError)) console.error(error);
  send(
    response,
    failure.status,
    { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", ...failure.headers },
    JSON.stringify(failure.body()),
  );
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? "GET";
  const changes = method !== "GET" && method !== "HEAD";
  if (changes && !sameOrigin(request)) throw new ApiError("CROSS_ORIGIN");
  const body = changes ? await readBody(request) : {};
  const matched = routes.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
  if (!matched) throw new ApiError("NOT_FOUND");
  const call: Call = {
    body,
    params: (matched.pattern.exec(url.pathname) ?? []).slice(1),
    query: url.searchParams,
    origin: originOf(request),
    sessionToken: cookieOf(request, SESSION_COOKIE),
  };
  if (matched.access === "open") return sendReply(response, await matched.run(call));
  const player = await sessionPlayer(request);
  if (!player) throw new ApiError("UNAUTHENTICATED");
  if (matched.access === "verified" && !player.verified) throw new ApiError("NOT_VERIFIED");
  sendReply(response, await matched.run(call, player));
}

async function sendPage(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  let status = PAGES.some((pattern) => pattern.test(pathname)) ? 200 : 404;
  const game = PLAY_PAGE.exec(pathname)?.[1];
  if (game !== undefined) {
    const player = await sessionPlayer(request).catch(() => null);
    if (player && !(await ownsGame(player.player_id, game))) status = 404;
  }
  send(response, status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }, await page());
}

async function sendAsset(response: ServerResponse, pathname: string): Promise<void> {
  const file = await readFile(`${CLIENT_ROOT}${pathname.slice(1)}`);
  const type = ASSET_TYPES[pathname.slice(pathname.lastIndexOf(".") + 1)] ?? "application/octet-stream";
  const cache = pathname.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "no-cache";
  send(response, 200, { "Content-Type": type, "Cache-Control": cache }, file);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", originOf(request));
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD") throw new ApiError("NOT_FOUND");
    if (ASSET.test(url.pathname)) return await sendAsset(response, url.pathname);
    await sendPage(request, response, url.pathname);
  } catch (error) {
    sendError(response, error);
  }
}

export function createServer(): http.Server {
  const server = http.createServer((request, response) => void handle(request, response));
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", originOf(request)).pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (!sameOrigin(request)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    void sessionPlayer(request).then(
      (player) => acceptSocket(request, socket, head, player),
      () => acceptSocket(request, socket, head, null),
    );
  });
  return server;
}
