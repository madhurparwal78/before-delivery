// The HTTP boundary: origin checks, body limits, content types and error
// responses. One place decides every cross-site and body rule.

import type { NextFunction, Request, Response } from "express";
import { errors, ApiError } from "./errors.js";

export function isCrossSiteWrite(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const origin = req.header("origin");
  if (origin !== undefined) {
    if (origin === "null") return true;
    try {
      const parsed = new URL(origin);
      const host = req.header("host") ?? "";
      // Compare host and port: a Host without port matches an Origin whose
      // port is the scheme default; otherwise the ports must match exactly.
      const originHost = parsed.hostname;
      const originPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      const hostParts = host.split(":");
      const hostHost = hostParts[0] ?? "";
      const hostPort = hostParts[1] ?? originPort;
      return !(originHost === hostHost && originPort === hostPort);
    } catch {
      return true;
    }
  }
  const fetchSite = req.header("sec-fetch-site");
  return fetchSite === "cross-site" || fetchSite === "same-site";
}

export function crossSiteGuard(req: Request, res: Response, next: NextFunction): void {
  if (isCrossSiteWrite(req)) {
    sendError(res, errors.crossOrigin());
    return;
  }
  next();
}

const JSON_LIMIT = 65_536;
const EXHIBIT_LIMIT = 10_000_000;

export function bodyLimit(req: Request, res: Response, next: NextFunction): void {
  const lengthHeader = req.header("content-length");
  const isExhibit = req.path.endsWith("/exhibit");
  const limit = isExhibit ? EXHIBIT_LIMIT : JSON_LIMIT;
  if (lengthHeader !== undefined) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > limit) {
      sendError(res, errors.payloadTooLarge());
      return;
    }
  }
  next();
}

export function contentTypeGuard(isExhibit: (path: string) => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    const contentType = req.header("content-type") ?? "";
    const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (isExhibit(req.path)) {
      if (base !== "application/pdf") {
        sendError(res, errors.unsupportedMediaType());
        return;
      }
    } else if (req.path.startsWith("/api/")) {
      // Requests without a body are fine without a content type.
      if (base !== "application/json" && base !== "") {
        sendError(res, errors.unsupportedMediaType());
        return;
      }
    }
    next();
  };
}

export function sendError(res: Response, error: ApiError): void {
  res.status(error.status).json(error.body());
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > JSON_LIMIT) throw errors.payloadTooLarge();
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw errors.invalidJson();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw errors.invalidJson();
  }
}

export async function readExhibitBody(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > EXHIBIT_LIMIT) throw errors.payloadTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
