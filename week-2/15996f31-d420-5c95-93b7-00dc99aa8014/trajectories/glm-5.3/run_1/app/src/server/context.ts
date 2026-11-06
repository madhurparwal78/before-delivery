import type { Request, Response, NextFunction } from "express";
import type { Config } from "./config.ts";
import type { Pool } from "./db.ts";
import { userForSession, type SessionUser } from "./store.ts";
import { ApiError } from "./errors.ts";
import { KillBillClient } from "./services/killbill.ts";
import { Storage } from "./services/storage.ts";
import type { Mailer } from "./services/mailer.ts";

export interface AppServices {
  config: Config;
  pool: Pool;
  killbill: KillBillClient;
  storage: Storage;
  clientDir: string;
  mailer: Mailer;
  /** True once PostgreSQL is connected; health answers "starting" until then. */
  dbReady: boolean;
}

export interface TypedRequest extends Request {
  actor?: SessionUser;
  parsedBody?: Record<string, unknown>;
}

export type Handler = (req: TypedRequest, res: Response) => Promise<void> | void;

/** Resolves the session actor; every desk request uses the cookie. */
export async function attachActor(services: AppServices, req: TypedRequest, res: Response, next: NextFunction): Promise<void> {
  const cookieHeader = req.headers.cookie ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("bloom_session="))
    ?.slice("bloom_session=".length);
  const user = await userForSession(services.pool, token);
  if (user) {
    req.actor = user;
    res.setHeader("Cache-Control", "no-store");
  }
  next();
}

/**
 * Parses the JSON request body once, enforcing the published envelope limits.
 * The photo upload is the one non-JSON route and handles its own bytes.
 */
export async function parseBody(req: TypedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  const isPhotoUpload = req.method === "POST" && req.path.startsWith("/api/inspect/") && /\/photos\/?$/.test(req.path);
  if (isPhotoUpload) {
    next();
    return;
  }
  try {
    req.parsedBody = asObject(await readRawJson(req));
    next();
  } catch (error) {
    next(error);
  }
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(415, "unsupported_media_type", "Send JSON for this request.");
  }
  return body as Record<string, unknown>;
}

async function readRawJson(req: TypedRequest): Promise<unknown> {
  const contentType = req.headers["content-type"];
  const declaredLength = Number(req.headers["content-length"] ?? "0");
  if (declaredLength > 64000) {
    throw new ApiError(413, "payload_too_large", "Requests are limited to 64,000 bytes.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 64000) {
        reject(new ApiError(413, "payload_too_large", "Requests are limited to 64,000 bytes."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", (error: Error) => reject(error));
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) {
    if (contentType && !contentType.includes("application/json")) {
      throw new ApiError(415, "unsupported_media_type", "Send JSON for this request.");
    }
    return {};
  }
  if (!contentType || !contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send JSON for this request.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(415, "unsupported_media_type", "Send JSON for this request.");
  }
}

export function bodyOf(req: TypedRequest): Record<string, unknown> {
  return req.parsedBody ?? {};
}

/** A single path parameter. */
export function param(req: TypedRequest, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

export function requireSession(req: TypedRequest): SessionUser {
  const actor = req.actor;
  if (!actor) throw ApiError.unauthenticated();
  return actor;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader("Set-Cookie", `bloom_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", "bloom_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
