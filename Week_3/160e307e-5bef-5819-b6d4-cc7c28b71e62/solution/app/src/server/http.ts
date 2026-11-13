import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { ApiError } from "./errors";
import { createGuest, openSession, playerBySession } from "./players";
import type { Player } from "./players";

/** Request plumbing: cookies, bodies with their limits, JSON replies, static files. */

export const BODY_LIMIT = 65536;
export const LOCAL_BODY_LIMIT = 1000000;
const SESSION_COOKIE = "dc_session";
const YEAR_SECONDS = 31536000;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: string[];
  body: unknown;
  cookies: Record<string, string>;
  setCookies: string[];
  player: () => Promise<Player>;
  maybePlayer: () => Promise<Player | null>;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${YEAR_SECONDS}`;
}

export function makeSessionReaders(req: IncomingMessage, cookies: Record<string, string>, setCookies: string[]) {
  let cached: Promise<Player | null> | null = null;
  const maybePlayer = (): Promise<Player | null> => {
    const token = cookies[SESSION_COOKIE];
    cached ??= token ? playerBySession(token) : Promise.resolve(null);
    return cached;
  };
  const player = async (): Promise<Player> => {
    const existing = await maybePlayer();
    if (existing) return existing;
    const guest = await createGuest();
    const token = await openSession(guest.id);
    setCookies.push(sessionCookie(token));
    cookies[SESSION_COOKIE] = token;
    cached = Promise.resolve(guest);
    return guest;
  };
  return { player, maybePlayer, req };
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = req.headers["content-length"];
  const hasBody = (declared !== undefined && declared !== "0") || req.headers["transfer-encoding"] !== undefined;
  if (declared !== undefined && Number(declared) > limit) throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  if (!hasBody) return {};
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(chunk as Buffer);
  }
  if (type !== "application/json") throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE");
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_PAYLOAD");
  }
}

export function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  if (res.headersSent) return;
  if (status === 204 || body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const PAGES: readonly RegExp[] = [
  /^\/$/,
  /^\/welcome$/,
  /^\/play\/local$/,
  /^\/shop$/,
  /^\/leaderboard$/,
  /^\/join(\/[A-Za-z0-9]{1,12})?$/,
  /^\/queue\/(casual|ranked)$/,
  /^\/room\/[A-Za-z0-9]{1,12}$/,
  /^\/match\/[A-Za-z0-9-]{1,64}$/,
  /^\/profile\/[A-Za-z0-9_-]{1,40}$/,
  /^\/auth\/link\/[A-Za-z0-9_-]{1,128}$/,
];

export function isPage(path: string): boolean {
  return PAGES.some((p) => p.test(path));
}

export function serveFile(res: ServerResponse, root: string, relative: string, cache: string): boolean {
  const file = resolve(join(root, normalize(relative)));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": cache });
  createReadStream(file).pipe(res);
  return true;
}
