/** HTTP boundary: body limits, content type, origin, and the one error responder. */

import type { NextFunction, Request, Response } from "express";
import { apiError, type ApiError } from "./errors.js";
import { config } from "../config.js";

export const MAX_BODY_BYTES = 16384;

export function originOfPublicBase(): string {
  try {
    return new URL(config().publicBase).origin;
  } catch {
    return config().publicBase;
  }
}

export function sendError(res: Response, err: ApiError): void {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields !== undefined) body.fields = err.fields;
  if (err.etag !== undefined) body.etag = err.etag;
  if (err.retryAfter !== undefined) res.setHeader("Retry-After", String(err.retryAfter));
  res.status(err.status).json(body);
}

export class HttpError extends Error {
  constructor(public readonly api: ApiError) {
    super(api.message);
    this.name = "HttpError";
  }
}

/** The origin rule and content-type rule, applied to every request. */
export function boundary(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin !== undefined && (origin === "null" || new URL(origin).origin !== originOfPublicBase())) {
      sendError(res, apiError(403, "cross_origin", "Requests from other origins are refused."));
      return;
    }
    const contentType = req.headers["content-type"];
    const length = Number(req.headers["content-length"] ?? "0");
    if (contentType !== undefined && contentType.trim() !== "" && !contentType.toLowerCase().startsWith("application/json")) {
      sendError(res, apiError(415, "unsupported_media_type", "Send a JSON body with Content-Type: application/json."));
      return;
    }
    if (length > MAX_BODY_BYTES) {
      sendError(res, apiError(413, "payload_too_large", "The body is too large."));
      return;
    }
  }
  next();
}

/** Answers express.json's errors in the one error shape. */
export function jsonBodyError(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err === null || err === undefined) {
    next();
    return;
  }
  const type = typeof err === "object" && err !== null && "type" in err ? (err as { type?: string }).type : undefined;
  if (type === "entity.too.large") {
    sendError(res, apiError(413, "payload_too_large", "The body is too large."));
    return;
  }
  if (type === "entity.parse.failed") {
    sendError(res, apiError(400, "invalid_json", "Send a JSON body."));
    return;
  }
  next(err);
}
