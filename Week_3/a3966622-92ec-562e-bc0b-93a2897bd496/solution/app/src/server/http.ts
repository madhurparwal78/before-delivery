// HTTP boundary: routing, sessions, request limits before a body is read in full, same-origin
// writes, the one error shape, and the static client (a fixed whitelist of built files).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ApiError, forbidden, invalid, methodNotAllowed, notFound, payloadTooLarge, unauthenticated, unsupportedType } from "./errors.js";
import type { Store, UserRecord } from "./store.js";

const JSON_LIMIT_BYTES = 65_536;
export const SESSION_COOKIE = "sw_session";

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

interface Request {
  method: string;
  url: URL;
  params: Record<string, string>;
  user: UserRecord | null;
  body: unknown;
  raw: IncomingMessage;
}

export interface SignedIn extends Request {
  user: UserRecord;
}

type Handler = (request: SignedIn) => Reply | Promise<Reply>;
type PublicHandler = (request: Request) => Reply | Promise<Reply>;

type Route = { method: string; pattern: RegExp; names: string[] } & (
  | { open: true; handler: PublicHandler }
  | { open: false; rawBody: boolean; handler: Handler }
);

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({ status, body, headers });
export const ok = (body: unknown, headers: Record<string, string> = {}): Reply => json(200, body, headers);
export const created = (body: unknown): Reply => json(201, body);

export function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body() };
}

const compile = (template: string): { pattern: RegExp; names: string[] } => {
  const names: string[] = [];
  const source = template.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), names };
};

export class Router {
  private readonly routes: Route[] = [];

  /** A route for signed-in users. `rawBody` routes read their own body after their access checks. */
  add(method: string, template: string, handler: Handler, rawBody = false): void {
    this.routes.push({ method, ...compile(template), open: false, rawBody, handler });
  }

  /** A route anyone may call. */
  open(method: string, template: string, handler: PublicHandler): void {
    this.routes.push({ method, ...compile(template), open: true, handler });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.names.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { route, params };
    }
    return pathMatched ? "method" : null;
  }
}

/** Reads a request body, refusing it as soon as it is known to be larger than `limit`. */
export function readBody(raw: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(raw.headers["content-length"] ?? "NaN");
  if (declared > limit) return Promise.reject(payloadTooLarge());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    raw.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        reject(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    raw.on("end", () => resolve(Buffer.concat(chunks)));
    raw.on("error", reject);
  });
}

const hasBody = (raw: IncomingMessage): boolean =>
  Number(raw.headers["content-length"] ?? 0) > 0 || raw.headers["transfer-encoding"] !== undefined;

async function readJson(raw: IncomingMessage): Promise<unknown> {
  if (!hasBody(raw)) return {};
  const declared = Number(raw.headers["content-length"] ?? "NaN");
  if (declared > JSON_LIMIT_BYTES) throw payloadTooLarge();
  const type = (raw.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw unsupportedType();
  const text = (await readBody(raw, JSON_LIMIT_BYTES)).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid({ body: "The request body is not valid JSON" });
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, ...reply.headers };
  if (reply.bytes) {
    res.writeHead(reply.status, { "Content-Length": String(reply.bytes.length), ...headers });
    res.end(reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/** The built client: every file under dist/client by URL path, read once at start. */
function loadClient(dir: string): { files: Map<string, { data: Buffer; type: string }>; shell: Buffer } {
  const files = new Map<string, { data: Buffer; type: string }>();
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const full = path.join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const type = STATIC_TYPES[path.extname(name)];
        if (type) files.set("/" + path.relative(dir, full).split(path.sep).join("/"), { data: readFileSync(full), type });
      }
    }
  };
  walk(dir);
  return { files, shell: readFileSync(path.join(dir, "index.html")) };
}

const APP_PATHS = [/^\/$/, /^\/login$/, /^\/board$/, /^\/orders$/, /^\/pilot$/, /^\/accounts$/, /^\/moves\/[^/]+$/, /^\/reports\/[^/]+$/, /^\/invoices\/[^/]+$/];

const sameOrigin = (raw: IncomingMessage): boolean => {
  const origin = raw.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === raw.headers.host;
  } catch {
    return false;
  }
};

export const sessionToken = (raw: IncomingMessage): string | undefined =>
  (raw.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === SESSION_COOKIE)?.[1];

function sessionUser(store: Store, raw: IncomingMessage): UserRecord | null {
  const token = sessionToken(raw);
  if (!token) return null;
  const session = store.sessions.get(token);
  return session ? store.users.get(session.user_id) : null;
}

export function startServer(store: Store, router: Router, clientDir: string, port: number): Server {
  const client = loadClient(clientDir);

  async function api(raw: IncomingMessage, url: URL): Promise<Reply> {
    const method = raw.method ?? "GET";
    if (!["GET", "HEAD"].includes(method) && !sameOrigin(raw)) throw forbidden();
    const found = router.match(method, url.pathname);
    if (found === null) throw notFound();
    if (found === "method") throw methodNotAllowed("Method not allowed");
    const { route, params } = found;
    const user = sessionUser(store, raw);
    if (route.open) {
      const body = method === "GET" ? {} : await readJson(raw);
      return route.handler({ method, url, params, user, body, raw });
    }
    if (!user) throw unauthenticated();
    const body = route.rawBody || method === "GET" ? {} : await readJson(raw);
    return route.handler({ method, url, params, user, body, raw });
  }

  return createServer((raw, res) => {
    const url = new URL(raw.url ?? "/", "http://app.invalid");
    if (url.pathname.startsWith("/api/")) {
      api(raw, url)
        .catch((error: unknown) => {
          if (error instanceof ApiError) return errorReply(error);
          console.error(error);
          return errorReply(new ApiError(500, "internal_error", "The server could not complete the request"));
        })
        .then((reply) => {
          if (!raw.complete) {
            reply.headers = { ...reply.headers, Connection: "close" };
            raw.resume();
          }
          send(res, reply);
        });
      return;
    }
    const file = client.files.get(url.pathname);
    if (file && (raw.method === "GET" || raw.method === "HEAD")) {
      send(res, { status: 200, bytes: file.data, headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=31536000, immutable" } });
      return;
    }
    const known = APP_PATHS.some((p) => p.test(url.pathname));
    send(res, {
      status: known ? 200 : 404,
      bytes: client.shell,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }).listen(port, "0.0.0.0");
}
