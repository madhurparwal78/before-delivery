import { type RequestHandler } from "express";
import { ApiError, errors, sendError } from "./errors.js";
import { MAX_BODY_BYTES } from "./config.js";

/** Sentinel for a failed request; unwrapped by the error handler. */
export class Handled {
  constructor(public readonly error: ApiError) {}
}

/**
 * Body handling with the published precedence: 413 body_too_large, 415
 * unsupported_media_type, 400 malformed_json, 400 idempotency_key_required.
 * Applies to state-changing requests with JSON bodies.
 */
export const jsonBody: RequestHandler = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > MAX_BODY_BYTES) {
    sendError(res, errors.bodyTooLarge());
    return;
  }
  const type = String(req.headers["content-type"] ?? "");
  if (type === "" || /json/i.test(type)) {
    let data = "";
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        sendError(res, errors.bodyTooLarge());
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (aborted) return;
      if (data === "") {
        (req as unknown as { body: unknown }).body = {};
        next();
        return;
      }
      try {
        (req as unknown as { body: unknown }).body = JSON.parse(data);
      } catch {
        sendError(res, errors.malformedJson());
        return;
      }
      next();
    });
    req.on("error", () => { /* already answered */ });
    return;
  }
  sendError(res, errors.unsupportedMedia());
};

/** Cross-origin: a state-changing request whose Origin names another origin answers 403. */
export const originGuard: RequestHandler = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "") {
    const host = req.headers.host;
    try {
      const u = new URL(origin);
      if (!host || u.host !== host) {
        sendError(res, errors.crossOrigin());
        return;
      }
    } catch {
      sendError(res, errors.crossOrigin());
      return;
    }
  }
  next();
};

