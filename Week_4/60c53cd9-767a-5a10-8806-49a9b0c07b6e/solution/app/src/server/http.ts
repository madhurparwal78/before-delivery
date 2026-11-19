/** The request pipeline: the published error precedence is applied here, once, for every route. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountRow, Accounts, Role } from "./accounts.js";
import type { AppClock } from "./clock.js";
import { ApiError } from "./errors.js";
import { CONTENT_TYPE, kindFromSignature } from "./images.js";
import { parseJsonObject, type ParsedBody } from "./json.js";

const JSON_LIMIT = 16_384;
const PHOTO_LIMIT = 5_000_000;
const DRAIN_CAP = 64 * 1024 * 1024;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type Auth = "none" | "optional" | "signedIn" | Role;

export interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly auth: Auth;
  readonly body: "json" | "photo" | "none";
  readonly handler: (ctx: RequestContext) => Promise<Result>;
}

interface RequestContext {
  readonly req: IncomingMessage;
  readonly url: URL;
  readonly params: readonly string[];
  readonly json: ParsedBody | null;
  readonly bytes: Buffer;
  readonly account: AccountRow | null;
  readonly clientAddress: string;
  readonly sessionToken: string | undefined;
}

export interface Result {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly raw?: Buffer;
}

const parseCookies = (header: string | undefined): Map<string, string> => {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
};

const readBody = async (req: IncomingMessage, limit: number): Promise<{ bytes: Buffer; tooLarge: boolean }> => {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = Number(req.headers["content-length"] ?? "0") > limit;
  let seen = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    seen += chunk.length;
    if (seen > DRAIN_CAP) {
      req.destroy();
      break;
    }
    if (size + chunk.length > limit) {
      tooLarge = true;
      continue;
    }
    size += chunk.length;
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), tooLarge };
};

const clientAddressOf = (req: IncomingMessage): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first && first !== "" ? first : (req.socket.remoteAddress ?? "unknown");
};

/** A write is same-origin when its Origin is the host it was addressed to or the app's own public origin. */
const sameOrigin = (req: IncomingMessage, publicOrigin: string): boolean => {
  const origin = req.headers["origin"];
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers["host"] || parsed.origin === publicOrigin;
  } catch {
    return false;
  }
};

export const send = (res: ServerResponse, clock: AppClock, result: Result): void => {
  const headers: Record<string, string> = {
    date: clock.now().toUTCString(),
    "x-content-type-options": "nosniff",
    ...result.headers,
  };
  if (result.raw !== undefined) {
    headers["content-length"] = String(result.raw.length);
    res.writeHead(result.status, headers);
    res.end(result.raw);
    return;
  }
  if (result.body === undefined) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(result.body);
  headers["content-type"] = "application/json; charset=utf-8";
  headers["cache-control"] ??= "no-store";
  headers["content-length"] = String(Buffer.byteLength(text));
  res.writeHead(result.status, headers);
  res.end(text);
};

export const errorResult = (error: ApiError): Result => ({
  status: error.status,
  body: error.body(),
  ...(error.retryAfterSeconds === undefined ? {} : { headers: { "retry-after": String(error.retryAfterSeconds) } }),
});

/** Steps 1 to 3 (body, origin, session), the role check (6), then the handler, which owns steps 4, 5 and 7 to 10. */
export const dispatch = async (
  route: Route,
  req: IncomingMessage,
  url: URL,
  params: readonly string[],
  accounts: Accounts,
  publicOrigin: string,
): Promise<Result> => {
  try {
    let bytes: Buffer = Buffer.alloc(0);
    if (WRITES.has(req.method ?? "")) {
      const limit = route.body === "photo" ? PHOTO_LIMIT : JSON_LIMIT;
      const read = await readBody(req, limit);
      if (read.tooLarge) throw new ApiError("too_large");
      bytes = read.bytes;
      if (route.body === "json" && bytes.length > 0 && !(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        throw new ApiError("unsupported_type");
      }
      if (route.body === "photo") {
        const declared = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
        const kind = kindFromSignature(bytes);
        if (kind === null || declared !== CONTENT_TYPE[kind]) throw new ApiError("unsupported_image");
      }
      if (!sameOrigin(req, publicOrigin)) throw new ApiError("cross_origin");
    }
    const sessionToken = parseCookies(req.headers.cookie).get("hw_session");
    const account = route.auth === "none" ? null : await accounts.fromToken(sessionToken);
    if (account === null && route.auth !== "none" && route.auth !== "optional") throw new ApiError("unauthenticated");
    if ((route.auth === "buyer" || route.auth === "coordinator") && account !== null && account.role !== route.auth) {
      throw new ApiError("forbidden");
    }
    const json = route.body === "json" ? parseJsonObject(bytes.toString("utf8")) : null;
    return await route.handler({
      req,
      url,
      params,
      json,
      bytes,
      account,
      clientAddress: clientAddressOf(req),
      sessionToken,
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResult(error);
    throw error;
  }
};
