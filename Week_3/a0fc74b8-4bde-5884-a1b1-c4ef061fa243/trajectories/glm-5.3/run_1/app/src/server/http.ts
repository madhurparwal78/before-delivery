import type { IncomingMessage, ServerResponse } from "node:http";
import { Ctx, ApiError, err } from "./core.js";

export interface RouteParams {
  [key: string]: string | undefined;
}

export interface Request {
  method: string;
  url: URL;
  params: RouteParams;
  body: unknown;
  rawBody: Buffer | null;
  cookies: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  req: IncomingMessage;
}

export type Handler = (req: Request, res: ServerResponse, ctx: Ctx) => Promise<void>;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

const MAX_JSON = 1_000_000;
export const MAX_UPLOAD = 25_000_000;

export function matchRoute(route: Route, method: string, pathname: string): RouteParams | null {
  if (route.method !== method) return null;
  const patParts = route.pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patParts.length !== pathParts.length) return null;
  const params: RouteParams = {};
  for (let i = 0; i < patParts.length; i++) {
    const p = patParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        reject(new ApiError(413, { error: "too_large", limit }));
        // Drain the remaining bytes so the client can read the response.
        chunks.length = 0;
        req.on("data", () => { /* discard */ });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => { if (!rejected) reject(e); });
  });
}

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return readBody(req, MAX_JSON).then((buf) => {
    if (buf.length === 0) return {};
    try {
      return JSON.parse(buf.toString("utf-8"));
    } catch {
      throw err(400, "bad_json");
    }
  });
}
