import type { Request, Response } from "express";
import { ApiError, err } from "./errors.ts";

export const MAX_BODY_BYTES = 65536;

export const parseCookie = (header: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
};

export const originOf = (req: Request): string => {
  const proto = Array.isArray(req.headers["x-forwarded-proto"])
    ? (req.headers["x-forwarded-proto"][0] as string)
    : (req.headers["x-forwarded-proto"] ?? "http");
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
};

export const crossOriginFailure = (req: Request): ApiError | null => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return null;
  const origin = req.headers.origin;
  if (!origin) return null;
  return origin !== originOf(req) ? err(403, "cross_origin") : null;
};

export type BodyResult =
  | { failure: ApiError; body: undefined; present: boolean }
  | { failure: null; body: unknown; present: boolean };

export async function readBody(req: Request): Promise<BodyResult> {
  const declared = Number.parseInt(req.headers["content-length"] ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { failure: err(413, "payload_too_large"), body: undefined, present: false };
  }

  const raw = await new Promise<{ buf: Buffer; truncated: boolean }>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const settle = (): void => {
      if (!settled) {
        settled = true;
        resolve({ buf: Buffer.concat(chunks), truncated });
      }
    };
    req.on("data", (chunk: Buffer) => {
      if (truncated) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        truncated = true;
        settle();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", settle);
    req.on("error", settle);
  });

  if (raw.truncated) return { failure: err(413, "payload_too_large"), body: undefined, present: false };

  const contentType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const hasBody = raw.buf.length > 0;

  if (!hasBody) return { failure: null, body: undefined, present: false };
  if (contentType !== "application/json") {
    return { failure: err(415, "unsupported_media_type"), body: undefined, present: false };
  }
  try {
    return { failure: null, body: JSON.parse(raw.buf.toString("utf8")) as unknown, present: true };
  } catch {
    return { failure: err(400, "invalid_json"), body: undefined, present: false };
  }
}

export const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export const sendJson = (res: Response, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void => {
  res.set({ "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.status(status).json(body);
};

export const sendError = (res: Response, e: ApiError, extraHeaders: Record<string, string> = {}): void => {
  sendJson(res, e.status, e.body, extraHeaders);
};
