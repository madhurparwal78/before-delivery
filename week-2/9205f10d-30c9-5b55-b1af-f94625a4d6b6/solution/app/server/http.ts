import type { IncomingMessage, ServerResponse } from "node:http";
import { SESSION_COOKIE, type Role, type User, userForToken } from "./auth.js";
import { ApiError, forbidden, notFound, validation } from "./errors.js";

/** A JSON body over this many bytes answers payload_too_large; exactly this many is allowed. */
const JSON_BODY_LIMIT = 65_536;
/** An upload request body over this many bytes is refused before it is read in full. */
const UPLOAD_BODY_LIMIT = 5_250_000;

export interface Reply {
  status: number;
  json?: unknown;
  text?: string;
  /** Raw bytes, for static files. */
  body?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export const ok = (json: unknown, status = 200): Reply => ({ status, json });

interface BaseContext {
  url: URL;
  params: Record<string, string>;
  rawBody: Buffer;
  header(name: string): string | undefined;
  sessionToken: string | undefined;
  /** Refuses a state-changing request whose Origin names another origin (precedence step 5). */
  sameOrigin(): void;
  /** The JSON object body; unsupported_type for another content type, validation when malformed. */
  json(): Record<string, unknown>;
}

export interface Context extends BaseContext {
  user: User;
  /** Step 5 of the error precedence: cross-origin, then a role the endpoint does not grant. */
  allow(...roles: Role[]): void;
}

interface PublicContext extends BaseContext {
  user: User | null;
}

type BodyKind = "json" | "upload";

type Route =
  | { method: string; pattern: RegExp; body: BodyKind; signedIn: true; handle: (ctx: Context) => Promise<Reply> }
  | { method: string; pattern: RegExp; body: BodyKind; signedIn: false; handle: (ctx: PublicContext) => Promise<Reply> };

function compile(path: string): RegExp {
  const source = path.replace(/[.]/g, "\\.").replace(/:(\w+)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${source}$`);
}

export class Router {
  private readonly routes: Route[] = [];

  /** An endpoint for signed-in callers; everyone else gets unauthenticated. */
  on(method: string, path: string, handle: (ctx: Context) => Promise<Reply>, body: BodyKind = "json"): void {
    this.routes.push({ method, pattern: compile(path), body, signedIn: true, handle });
  }

  /** An endpoint anyone may call. */
  open(method: string, path: string, handle: (ctx: PublicContext) => Promise<Reply>): void {
    this.routes.push({ method, pattern: compile(path), body: "json", signedIn: false, handle });
  }

  async dispatch(req: IncomingMessage, url: URL): Promise<Reply> {
    let pathMatched: { route: Route; params: Record<string, string> } | undefined;
    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      const params = decodedParams(match.groups ?? {});
      if (route.method === req.method) {
        pathMatched = { route, params };
        break;
      }
    }
    if (!pathMatched) {
      req.resume();
      throw notFound();
    }
    const { route, params } = pathMatched;
    const rawBody = await readBody(req, route.body === "upload" ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT);
    const sessionToken = cookie(req.headers.cookie, SESSION_COOKIE);
    const user = sessionToken ? await userForToken(sessionToken) : null;
    const base = baseContext(req, url, params, rawBody, sessionToken);
    if (!route.signedIn) return route.handle({ ...base, user });
    if (!user) throw new ApiError("unauthenticated", "Sign in to continue.");
    return route.handle({
      ...base,
      user,
      allow(...roles: Role[]) {
        base.sameOrigin();
        if (!roles.includes(user.role)) throw forbidden();
      },
    });
  }
}

/** Path parameters, decoded; a malformed escape stays as sent, so it names nothing and reads as not found. */
function decodedParams(groups: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => {
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    }),
  );
}

function baseContext(
  req: IncomingMessage,
  url: URL,
  params: Record<string, string>,
  rawBody: Buffer,
  sessionToken: string | undefined,
): BaseContext {
  const header = (name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  const method = req.method ?? "GET";
  return {
    url,
    params,
    rawBody,
    header,
    sessionToken,
    sameOrigin() {
      const origin = header("origin");
      if (method === "GET" || method === "HEAD" || origin === undefined) return;
      const host = header("host");
      const allowed = host ? [`http://${host}`, `https://${host}`] : [];
      if (!allowed.includes(origin)) throw forbidden();
    },
    json() {
      const type = (header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (rawBody.length === 0 && !type) return {};
      if (type !== "application/json") throw new ApiError("unsupported_type", "Send the body as application/json.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw validation({ body: "Send a valid JSON object." });
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw validation({ body: "Send a JSON object." });
      }
      return parsed as Record<string, unknown>;
    },
  };
}

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/** Reads the body up to a limit; past it the rest is drained unread and the call is refused. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const tooLarge = () => new ApiError("payload_too_large", `The request body is over ${limit} bytes.`);
  if (Number(req.headers["content-length"]) > limit) {
    req.resume();
    return Promise.reject(tooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > limit) {
        refused = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...BASE_HEADERS, ...reply.headers };
  if (reply.json !== undefined) {
    const body = JSON.stringify(reply.json);
    res.writeHead(reply.status, {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  const body = reply.body ?? reply.text ?? "";
  res.writeHead(reply.status, {
    ...headers,
    "Content-Type": reply.contentType ?? "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/** The one place an error becomes a reply; idempotent routes store this same reply. */
export function errorReply(error: ApiError): Reply {
  return { status: error.status, json: error.body() };
}

export function sendError(res: ServerResponse, error: unknown): void {
  const failure =
    error instanceof ApiError ? error : new ApiError("internal", "Something went wrong on our side. Try again.");
  if (!(error instanceof ApiError)) console.error(error);
  send(res, errorReply(failure));
}
