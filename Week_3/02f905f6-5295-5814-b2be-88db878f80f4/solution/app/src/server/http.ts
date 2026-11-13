// Request pipeline: the server boundary and the single error precedence of the API.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { User } from "../shared/api";
import { authenticate } from "./auth";
import { config } from "./config";
import { idempotent } from "./idempotency";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, "not_found", "Not found.");
export const forbidden = () => new HttpError(403, "forbidden", "Your role can't do that.");
export const invalidFields = (fields: Record<string, string>) =>
  new HttpError(422, "invalid_fields", "Check these fields", { fields });

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** a binary body sent as is (photos) */
  bytes?: { data: Buffer; contentType: string };
}

export interface FilePart {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  /** parsed JSON body; undefined when the body is empty or not valid JSON */
  body: unknown;
  files: Record<string, FilePart>;
  user: User | null;
}

export interface SignedInCtx extends Ctx {
  user: User;
}

type BodyKind = "json" | "multipart" | "none";

interface RouteBase {
  method: string;
  path: string;
  body: BodyKind;
  /** accepts an Idempotency-Key */
  idempotent?: true;
}

export type Route =
  | (RouteBase & { auth: false; handler: (ctx: Ctx) => Promise<Reply> })
  | (RouteBase & { auth: true; handler: (ctx: SignedInCtx) => Promise<Reply> });

const JSON_LIMIT = 65_536;
const PHOTO_LIMIT = 8_000_000;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

type CompiledRoute = Route & {
  regex: RegExp;
  keys: string[];
};

function compile(route: Route): CompiledRoute {
  const keys: string[] = [];
  const source = route.path.replace(/:([a-z_]+)/g, (_m, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { ...route, regex: new RegExp(`^${source}$`), keys };
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

export function errorBody(error: HttpError): Record<string, unknown> {
  return { error: error.code, message: error.message, ...error.extra };
}

function sendError(res: ServerResponse, error: HttpError, headers: Record<string, string> = {}): void {
  sendJson(res, error.status, errorBody(error), headers);
}

interface ReadBody {
  data: Buffer;
  tooLarge: boolean;
}

/** Reads the body, counting every byte; past `limit` the rest is drained and discarded. */
function readBody(req: IncomingMessage, limit: number): Promise<ReadBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve({ data: Buffer.concat(chunks), tooLarge: total > limit }));
    req.on("close", () => resolve({ data: Buffer.concat(chunks), tooLarge: total > limit }));
    req.on("error", reject);
  });
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function parseMultipart(req: IncomingMessage, data: Buffer): Record<string, FilePart> | null {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(req.headers["content-type"] ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  const files: Record<string, FilePart> = {};
  let start = data.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length + 2;
    const next = data.indexOf(delimiter, headerStart);
    if (next === -1) break;
    const headerEnd = data.indexOf("\r\n\r\n", headerStart);
    if (headerEnd !== -1 && headerEnd < next) {
      const head = data.subarray(headerStart, headerEnd).toString("utf8");
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim().toLowerCase() ?? "application/octet-stream";
      if (name !== undefined && filename !== undefined) {
        files[name] = { filename, contentType: type, data: data.subarray(headerEnd + 4, next - 2) };
      }
    }
    start = next;
  }
  return files;
}

function ownOrigin(req: IncomingMessage, origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === req.headers.host || host === new URL(config.publicUrl).host;
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function apiHandler(routeList: Route[]) {
  const routes = routeList.map(compile);

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    try {
      const origin = req.headers.origin;
      if (STATE_CHANGING.has(method) && origin !== undefined && !ownOrigin(req, origin)) {
        throw new HttpError(403, "cross_origin", "Cross-origin request refused.");
      }
      const onPath = routes.filter((r) => r.regex.test(url.pathname));
      if (onPath.length === 0) {
        req.resume();
        if (!(await authenticate(req))) throw new HttpError(401, "unauthenticated", "Sign in first.");
        throw notFound();
      }
      const route = onPath.find((r) => r.method === method);
      if (!route) {
        const allow = [...new Set(onPath.map((r) => r.method))].join(", ");
        sendError(res, new HttpError(405, "method_not_allowed", "Method not allowed."), { Allow: allow });
        req.resume();
        return;
      }
      const ctx: Ctx = { req, url, params: {}, body: undefined, files: {}, user: null };
      const found = route.regex.exec(url.pathname);
      route.keys.forEach((key, i) => {
        ctx.params[key] = decodeURIComponent(found?.[i + 1] ?? "");
      });

      if (route.body === "multipart") {
        const read = await readBody(req, PHOTO_LIMIT + JSON_LIMIT);
        if (read.tooLarge) throw new HttpError(413, "too_large", "Photo is over 8,000,000 bytes");
        if (mediaType(req) !== "multipart/form-data") {
          throw new HttpError(415, "unsupported_type", "Use a JPEG, PNG, WebP or HEIC photo");
        }
        const files = parseMultipart(req, read.data);
        if (files === null) throw new HttpError(415, "unsupported_type", "Use a JPEG, PNG, WebP or HEIC photo");
        const photo = files.photo;
        if (photo && photo.data.length > PHOTO_LIMIT) {
          throw new HttpError(413, "too_large", "Photo is over 8,000,000 bytes");
        }
        if (photo && !PHOTO_TYPES.includes(photo.contentType)) {
          throw new HttpError(415, "unsupported_type", "Use a JPEG, PNG, WebP or HEIC photo");
        }
        ctx.files = files;
      } else if (route.body === "json") {
        const read = await readBody(req, JSON_LIMIT);
        if (read.tooLarge) throw new HttpError(413, "too_large", "The request body is over 65,536 bytes.");
        if (read.data.length > 0) {
          if (mediaType(req) !== "application/json") {
            throw new HttpError(415, "unsupported_type", "Send the request body as application/json.");
          }
          try {
            ctx.body = JSON.parse(read.data.toString("utf8"));
          } catch {
            ctx.body = undefined;
          }
        }
      } else {
        req.resume();
      }

      ctx.user = await authenticate(req);
      let reply: Reply;
      if (route.auth) {
        const user = ctx.user;
        if (!user) throw new HttpError(401, "unauthenticated", "Sign in first.");
        const signedIn: SignedInCtx = { ...ctx, user };
        const run = () => route.handler(signedIn);
        reply = route.idempotent ? await idempotent(signedIn, run) : await run();
      } else {
        reply = await route.handler(ctx);
      }
      writeReply(res, reply);
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error);
        return;
      }
      console.error(`${method} ${url.pathname} failed:`, error);
      sendError(res, new HttpError(500, "server_error", "Something went wrong on the studio server."));
    }
  };
}

function writeReply(res: ServerResponse, reply: Reply): void {
  if (reply.bytes) {
    res.writeHead(reply.status, {
      "Content-Type": reply.bytes.contentType,
      "Content-Length": reply.bytes.data.length,
      "Cache-Control": "private, max-age=3600",
      ...reply.headers,
    });
    res.end(reply.bytes.data);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, { "Cache-Control": "no-store", ...reply.headers });
    res.end();
    return;
  }
  sendJson(res, reply.status, reply.body, reply.headers);
}

/** A JSON object body, or an empty record when the body is missing or not an object. */
export function fieldsOf(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
