import type { IncomingMessage, ServerResponse } from "node:http";
import { BODY_LIMIT_BYTES } from "./config.js";
import { ApiError, fail } from "./errors.js";

export interface Context {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  body: Buffer;
  cookies: Record<string, string>;
}

export type Reply =
  | { status: number; json: unknown; headers?: Record<string, string> }
  | { status: number; raw: Buffer | string; headers: Record<string, string> };

export type Handler = (ctx: Context) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      })}$`,
    );
    this.routes.push({ method, pattern, keys, handler });
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      let malformed = false;
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(m[i + 1]!);
        } catch {
          malformed = true;
        }
      });
      if (malformed) continue;
      return { handler: route.handler, params };
    }
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

/** Reads the request body, refusing anything over the body limit before any other check. */
export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > BODY_LIMIT_BYTES) {
      req.resume();
      reject(fail.bodyTooLarge(BODY_LIMIT_BYTES));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on("data", (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        refused = true;
        reject(fail.bodyTooLarge(BODY_LIMIT_BYTES));
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

export function parseJson(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw fail.invalid({ body: "Send a JSON object." });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw fail.invalid({ body: "Send a JSON object." });
  return value as Record<string, unknown>;
}

const JSON_TYPE = "application/json; charset=utf-8";

export function send(res: ServerResponse, reply: Reply): void {
  if ("json" in reply) {
    if (reply.status === 204) {
      res.writeHead(204, reply.headers ?? {});
      res.end();
      return;
    }
    const body = JSON.stringify(reply.json);
    res.writeHead(reply.status, { "Content-Type": JSON_TYPE, "Cache-Control": "no-store", ...(reply.headers ?? {}) });
    res.end(body);
    return;
  }
  res.writeHead(reply.status, { "Cache-Control": "no-store", ...reply.headers });
  res.end(reply.raw);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    send(res, { status: error.status, json: error.body, headers: error.headers });
    return;
  }
  const code = (error as { code?: string }).code;
  const databaseDown = typeof code === "string" && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|57P|08)/.test(code);
  const message = (error as Error).message ?? "";
  if (databaseDown || /Connection terminated|timeout exceeded when trying to connect/i.test(message)) {
    const down = fail.database();
    send(res, { status: down.status, json: down.body });
    return;
  }
  console.error(error);
  const broken = fail.server();
  send(res, { status: broken.status, json: broken.body });
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply =>
  headers ? { status, json: body, headers } : { status, json: body };
