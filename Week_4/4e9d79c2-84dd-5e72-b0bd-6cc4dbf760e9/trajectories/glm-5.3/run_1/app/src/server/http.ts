import type { Request, Response, NextFunction } from "express";
import { errors, HttpError } from "./errors.js";

export const JSON_LIMIT = 100_000;
export const STATEMENT_LIMIT = 2_000_000;
export const PASSENGER_LIMIT = 1_000_000;
export const SHEET_LIMIT = 2_000_000;
export const PAPER_LIMIT = 5_000_000;
export const MULTIPART_LIMIT = 5_100_000;

export async function readJson(req: Request): Promise<unknown> {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw errors.unsupportedType();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.from(c);
    total += b.length;
    if (total > JSON_LIMIT) throw errors.tooLarge();
    chunks.push(b);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw errors.malformedJson();
  }
}

export async function readText(req: Request, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const b = Buffer.from(c);
    total += b.length;
    if (total > limit) throw errors.tooLarge();
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function requireDepth(value: unknown, depth = 0): void {
  if (depth > 16) throw errors.invalid({ q: "Search text can be up to 200 characters." });
  if (Array.isArray(value)) {
    for (const v of value) requireDepth(v, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) requireDepth(v, depth + 1);
  }
}

export function cappedString(v: unknown, max: number, field: string, copy: string): string {
  if (typeof v !== "string") throw errors.invalid({ [field]: copy });
  if (v.length > max) throw errors.invalid({ [field]: copy }, copy);
  return v;
}

export function sendError(res: Response, err: HttpError): void {
  const body: Record<string, unknown> = { error: { code: err.code, message: err.message } };
  if (err.fields && Object.keys(err.fields).length) (body.error as Record<string, unknown>).fields = err.fields;
  const headers = { ...(err.headers ?? {}) };
  if (err.status === 405) headers.Allow = err.headers?.Allow ?? "GET";
  res.status(err.status).set(headers).json(body);
}

export function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/** Express JSON error handler producing the one published body. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    sendError(res, err);
    return;
  }
  sendError(res, errors.unknownRoute());
}
