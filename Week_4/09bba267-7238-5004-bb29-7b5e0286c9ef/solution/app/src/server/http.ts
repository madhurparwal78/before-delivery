// The HTTP boundary: body checks, same-origin rule, buyer cookie, the one error shape and the static allow-list.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

interface ErrorBody {
  error: string;
  [extra: string]: unknown;
}

/** Thrown by handlers; the server answers `status` with `body`, which always has the brief's error shape. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(body.error);
  }
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): HttpError =>
  new HttpError(status, { error, ...extra });

export const validation = (fields: Record<string, string>): HttpError => fail(422, "validation", { fields });

export interface Reply {
  status: number;
  body?: unknown;
  cookies?: string[];
}

export interface Context {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  buyerId: string;
  ownerToken: string | null;
  idempotencyKey: string | null;
  now: Date;
}

const BODY_LIMIT = 16_384;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > BODY_LIMIT) return reject(fail(413, "payload_too_large"));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.removeAllListeners("data");
        reject(fail(413, "payload_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Body checks come before every other check: size, media type, then JSON. An empty body reads as `{}`. */
export async function parseBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw fail(415, "unsupported_media_type");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw fail(400, "bad_json");
  }
  // Every endpoint takes a JSON object; any other JSON value has none of its fields and fails validation.
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

/** A request whose Origin names another host and port than its Host header is refused. */
export function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw fail(403, "cross_origin");
  }
  if (host !== (req.headers.host ?? "")) throw fail(403, "cross_origin");
}

export function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

const BUYER_COOKIE = "seatwise_buyer";
export const OWNER_COOKIE = "seatwise_owner";

export const setCookie = (name: string, value: string): string => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
export const clearCookie = (name: string): string => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The buyer the cookie names, or a new buyer whose cookie the response sets. */
export async function identifyBuyer(jar: Map<string, string>): Promise<{ buyerId: string; cookie: string | null }> {
  const presented = jar.get(BUYER_COOKIE);
  if (presented && /^[a-f0-9]{32}$/.test(presented)) {
    const known = await pool.query("SELECT 1 FROM buyers WHERE id = $1", [presented]);
    if (known.rowCount) return { buyerId: presented, cookie: null };
  }
  const buyerId = randomBytes(16).toString("hex");
  await pool.query("INSERT INTO buyers (id) VALUES ($1)", [buyerId]);
  return { buyerId, cookie: setCookie(BUYER_COOKIE, buyerId) };
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

export function sendJson(res: ServerResponse, status: number, body: unknown, setCookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS, "Cache-Control": "no-store" };
  if (setCookies.length) headers["Set-Cookie"] = setCookies;
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const CLIENT_DIR = fileURLToPath(new URL("../../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

/** Built client assets under `/assets/`; anything else is not served from disk. */
export async function sendAsset(res: ServerResponse, path: string): Promise<boolean> {
  if (!/^\/assets\/[A-Za-z0-9._-]+$/.test(path)) return false;
  const file = normalize(join(CLIENT_DIR, path));
  const type = TYPES[extname(file)];
  if (!type || !file.startsWith(CLIENT_DIR)) return false;
  try {
    const content = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

let shell: Buffer | null = null;

/** The single-page shell; unknown paths get it with 404 and the client shows the not-found page. */
export async function sendPage(res: ServerResponse, status: number, setCookies: string[]): Promise<void> {
  shell ??= await readFile(join(CLIENT_DIR, "index.html"));
  const headers: Record<string, string | string[]> = {
    ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
  };
  if (setCookies.length) headers["Set-Cookie"] = setCookies;
  res.writeHead(status, headers).end(shell);
}
