// The one router and the one ladder every request walks: route, size, rate limit, origin, authentication,
// resource, content type, JSON, then the handler's own fields, state and stale checks.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readerLength } from "../shared/rules.js";
import { ukTime } from "../shared/time.js";

const JSON_LIMIT = 100_000;
export const MULTIPART_LIMIT = 5_100_000;
const PAPER_LIMIT = 5_000_000;
const DEPTH_CAP = 16;
export const SEARCH_CAP = 200;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>, public headers?: Record<string, string>) {
    super(message);
  }
}
export const notFound = (): ApiError => new ApiError(404, "notFound", "We can't find that.");
export const refused = (message: string, field?: string): ApiError =>
  new ApiError(422, "invalid", message, field ? { [field]: message } : undefined);
export const fieldErrors = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "invalid", Object.values(fields)[0], fields);
export const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);
export const unavailable = (code: string, message: string): ApiError => new ApiError(503, code, message);

interface Reply { status: number; body?: unknown; raw?: Buffer | string; headers?: Record<string, string> }
export const ok = (body: unknown, status = 200): Reply => ({ status, body });
export const noContent = (): Reply => ({ status: 204 });

/** A request body or provider reply: untrusted input, checked field by field where it is read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Untrusted = any;

export interface Ctx<Loaded = unknown> {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  raw: Buffer;
  text: string;
  json: Untrusted;
  files: Record<string, { filename: string; contentType: string; data: Buffer }>;
  form: Record<string, string>;
  desk: Desk | null;
  loaded: Loaded;
}
export interface Desk { id: string; name: string; email: string }

type BodyKind = "json" | "csv" | "multipart" | "none";
interface RouteSpec<Loaded> {
  method: string;
  path: string;
  /** "public" and "private" routes need no session. */
  access?: "desk" | "public" | "private";
  body?: BodyKind;
  limit?: number;
  rateLimit?: (ctx: Ctx) => Promise<void>;
  load?: (ctx: Ctx) => Promise<Loaded>;
  run: (ctx: Ctx<Loaded>) => Promise<Reply>;
}
export type ApiRoute = RouteSpec<unknown>;
/** A route whose handler sees what its `load` step found, typed. */
export const route = <Loaded = undefined>(spec: RouteSpec<Loaded>): ApiRoute => spec as ApiRoute;

interface Compiled extends ApiRoute { parts: string[] }
const compile = (route: ApiRoute): Compiled => ({ ...route, parts: route.path.split("/").filter(Boolean) });

const matchParts = (parts: string[], segments: string[]): Record<string, string> | null => {
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(":")) {
      try {
        const value = decodeURIComponent(segments[i]);
        // A control character never names anything here, and Postgres refuses a NUL outright.
        if (/[\u0000-\u001f\u007f]/.test(value)) return null;
        params[parts[i].slice(1)] = value;
      } catch {
        return null;
      }
    } else if (parts[i] !== segments[i]) return null;
  }
  return params;
};

export const send = (res: ServerResponse, reply: Reply): void => {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer | string | undefined = reply.raw;
  if (reply.body !== undefined) {
    payload = JSON.stringify(reply.body);
    headers["Content-Type"] = "application/json; charset=utf-8";
  }
  res.writeHead(reply.status, headers);
  res.end(payload);
};

export const errorReply = (error: ApiError): Reply => ({
  status: error.status,
  headers: error.headers,
  body: { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } },
});

const readBody = (req: IncomingMessage, limit: number): Promise<Buffer | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!over) resolve(null);
        over = true;
        chunks.length = 0;
      } else if (!over) chunks.push(chunk);
    });
    req.on("end", () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });

const depthOver = (text: string, cap: number): boolean => {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      depth += 1;
      if (depth > cap) return true;
    } else if (c === "}" || c === "]") depth -= 1;
  }
  return false;
};

const headerValue = (req: IncomingMessage, name: string): string => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
};

const contentTypeIs = (req: IncomingMessage, kind: BodyKind): boolean => {
  const type = headerValue(req, "content-type").split(";")[0].trim().toLowerCase();
  if (kind === "json") return type === "application/json";
  if (kind === "csv") return type === "text/csv";
  if (kind === "multipart") return type === "multipart/form-data";
  return true;
};

const foreignOrigin = (req: IncomingMessage): boolean => {
  const origin = headerValue(req, "origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== headerValue(req, "host");
  } catch {
    return true;
  }
};

/** Splits a multipart body into its fields and files. The file-part limit is applied here, before authentication. */
const parseMultipart = (raw: Buffer, contentType: string): Pick<Ctx, "files" | "form"> | null => {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const files: Ctx["files"] = {};
  const form: Ctx["form"] = {};
  let at = raw.indexOf(marker);
  while (at >= 0) {
    const start = at + marker.length;
    if (raw[start] === 45 && raw[start + 1] === 45) break;
    const headerEnd = raw.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) break;
    const next = raw.indexOf(Buffer.concat([Buffer.from("\r\n"), marker]), headerEnd + 4);
    if (next < 0) break;
    const head = raw.subarray(start, headerEnd).toString("utf8");
    const data = raw.subarray(headerEnd + 4, next);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name && filename !== undefined) {
      files[name] = { filename, contentType: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? "", data };
    } else if (name) form[name] = data.toString("utf8");
    at = next + 2;
  }
  return { files, form };
};

export type Authenticate = (req: IncomingMessage) => Promise<{ desk: Desk | null; ended: boolean }>;

export const makeApi = (routes: ApiRoute[], authenticate: Authenticate) => {
  const compiled = routes.map(compile);
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const respond = (reply: Reply): void => {
      send(res, reply);
      req.resume();
    };
    try {
      const method = req.method ?? "GET";
      const segments = url.pathname.split("/").filter(Boolean);
      const pathMatches = compiled.map((route) => ({ route, params: matchParts(route.parts, segments) })).filter((m) => m.params);
      if (!pathMatches.length) throw notFound();
      const match = pathMatches.find((m) => m.route.method === method);
      if (!match) {
        const allow = [...new Set(pathMatches.map((m) => m.route.method))].join(", ");
        throw new ApiError(405, "methodNotAllowed", "That method is not allowed here.", undefined, { Allow: allow });
      }
      const route = match.route;
      const body = route.body ?? "none";

      // Size, before the body is parsed and before authentication.
      const limit = route.limit ?? JSON_LIMIT;
      const tooLarge = (): ApiError => new ApiError(413, "tooLarge", "That is larger than this address accepts.");
      const declared = Number(headerValue(req, "content-length"));
      if (Number.isFinite(declared) && declared > limit) throw tooLarge();
      const raw = await readBody(req, limit);
      if (raw === null) throw tooLarge();
      const ctx: Ctx = { req, params: match.params as Record<string, string>, query: url.searchParams, raw, text: "", json: undefined, files: {}, form: {}, desk: null, loaded: undefined };
      if (body === "multipart" && contentTypeIs(req, "multipart")) {
        const parsed = parseMultipart(raw, headerValue(req, "content-type"));
        if (parsed) {
          Object.assign(ctx, parsed);
          if (Object.values(parsed.files).some((file) => file.data.length > PAPER_LIMIT)) throw tooLarge();
        }
      }

      const session = await authenticate(req);
      ctx.desk = session.desk;
      if (route.rateLimit) await route.rateLimit(ctx);
      if (!["GET", "HEAD"].includes(method) && foreignOrigin(req)) throw new ApiError(403, "foreignOrigin", "That request came from another site.");
      if ((route.access ?? "desk") === "desk" && !session.desk) {
        throw session.ended
          ? new ApiError(401, "sessionEnded", "Your session ended. Sign in again to keep going — what you typed is still here.")
          : new ApiError(401, "notSignedIn", "Sign in to keep going.");
      }
      if (route.load) ctx.loaded = await route.load(ctx);
      if (body !== "none" && !contentTypeIs(req, body)) throw new ApiError(415, "unsupportedType", "That content type is not accepted here.");
      if (body === "csv") ctx.text = raw.toString("utf8");
      if (body === "json") {
        const text = raw.toString("utf8");
        try {
          ctx.json = JSON.parse(text);
        } catch {
          if (depthOver(text, DEPTH_CAP)) throw refused("That request is nested too deeply.");
          throw new ApiError(400, "malformedJson", "That request could not be read.");
        }
        if (depthOver(text, DEPTH_CAP)) throw refused("That request is nested too deeply.");
        ctx.text = text;
        if (ctx.json === null || typeof ctx.json !== "object" || Array.isArray(ctx.json)) throw refused("That request could not be read.");
      }
      respond(await route.run(ctx));
    } catch (error) {
      if (error instanceof ApiError) respond(errorReply(error));
      else {
        console.error(error);
        respond(errorReply(new ApiError(500, "internal", "Something went wrong. Try again.")));
      }
    }
  };
};

export const searchText = (query: URLSearchParams, name = "q"): string | null => {
  const value = query.get(name);
  if (value === null) return null;
  if (readerLength(value) > SEARCH_CAP) throw refused("Search text can be up to 200 characters.", name);
  return value;
};

/** The refusal of a limit that reopens at a known moment, its UK time with the minute rounded up. */
export const limitReached = (code: string, copy: (time: string) => string, reopens: number, now: number): ApiError => {
  const rounded = reopens % 60 ? reopens - (reopens % 60) + 60 : reopens;
  return new ApiError(429, code, copy(ukTime(rounded)), undefined, { "Retry-After": String(Math.max(reopens - now, 1)) });
};
/** A list of objects from an untrusted body; anything else reads as empty and is refused by its caller. */
export const objectsIn = (value: unknown): Untrusted[] =>
  (Array.isArray(value) && value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v)) ? value : []);

export const newId = (prefix: string): string => `${prefix}-${randomBytes(6).toString("hex").toUpperCase()}`;
export const newToken = (): string => randomBytes(24).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export const moneyText = (pennies: number): string => {
  const sign = pennies < 0 ? "-" : "";
  return `${sign}${Math.floor(Math.abs(pennies) / 100)}.${String(Math.abs(pennies) % 100).padStart(2, "0")}`;
};
/** A strict money string ("1157.25") in pennies, or null. */
export const parseMoney = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, part = ""] = value.split(".");
  return Number(`${whole}${part.padEnd(2, "0")}`);
};
export const instantText = (seconds: number | null | undefined): string | null =>
  seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString().replace(/\.\d+Z$/, "Z");
