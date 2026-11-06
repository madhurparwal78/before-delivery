// Shared API helpers: the error shape, request parsing and body handling.

import type { IncomingMessage } from "node:http";
import type { SessionRow } from "./sessions.js";

export const JSON_BODY_CAP = 1000000;

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
    public headers?: Record<string, string>
  ) {
    super("http");
  }
}

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  session: SessionRow | null;
  raw: IncomingMessage;
}

export interface RouteResult {
  status: number;
  body: unknown;
  setCookie?: string;
  headers?: Record<string, string>;
}

export function header(req: ApiRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export async function readBody(req: IncomingMessage, cap: number): Promise<{ ok: Buffer | null; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve) => {
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > cap) {
        resolve({ ok: null, tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve({ ok: Buffer.concat(chunks), tooLarge: false }));
    req.on("error", () => resolve({ ok: null, tooLarge: size > cap }));
  });
}

/** Parse the JSON body; a body over the cap answers 413. */
export function jsonBody(req: ApiRequest): Record<string, unknown> {
  if (req.body.length > JSON_BODY_CAP) throw new HttpError(413, { error: "too_large" });
  if (req.body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body.toString("utf8"));
  } catch {
    throw new HttpError(422, { error: "validation", errors: { body: "Send JSON." } });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(422, { error: "validation", errors: { body: "Send a JSON object." } });
  }
  return parsed as Record<string, unknown>;
}

export function validationError(errors: Record<string, string>): HttpError {
  if (Object.keys(errors).length === 0) return new HttpError(422, { error: "validation", errors: { "": "" } });
  return new HttpError(422, { error: "validation", errors });
}
