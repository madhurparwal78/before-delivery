// The Express app: server boundary, auth, and the whole /api surface.
import express, { type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { ApiError, apiErrorHandler, errors } from "./errors.js";
import { accountForSession, createSession, deleteSession, hashPassword, lockKeyFor, recordFailure, resetFailures, checkLock, SESSION_COOKIE, verifyPassword } from "./auth.js";
import type { AppConfig } from "./config.js";
import { OTHER_BODY_LIMIT_BYTES, SYNC_BODY_LIMIT_BYTES } from "#shared/strokes.js";
import { safeNextPath } from "#shared/nextpath.js";
import { fieldMessages } from "#shared/messages.js";
import { normaliseEmail, validDisplayName } from "./validate.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      accountId?: string;
      rawBody?: Buffer;
    }
  }
}

export function boundaryMiddleware(config: AppConfig, apiRoutes: express.Router): express.Handler[] {
  const handlers: express.Handler[] = [];

  // Body limits: 5,000,000 for sync, 100,000 everywhere else.
  handlers.push((req, res, next) => {
    const isSync = req.path === "/api/sync" && req.method === "POST";
    const limit = isSync ? SYNC_BODY_LIMIT_BYTES : OTHER_BODY_LIMIT_BYTES;
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        const err = errors.tooLarge();
        if (!res.headersSent) {
          res.status(err.status).json(err.body());
        }
        req.destroy();
      }
    });
    next();
  });

  // Wrong content type on any body-bearing route.
  handlers.push((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const methodWithBody = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE";
    if (!methodWithBody) return next();
    if (req.path === "/api/sync" && req.method === "POST") {
      // sync declares its body type below
    }
    const contentType = req.headers["content-type"] ?? "";
    const isJson = contentType.split(";")[0]?.trim() === "application/json";
    if (!isJson && req.path.startsWith("/api/") && req.path !== "/api/health") {
      return next(errors.unsupportedMediaType());
    }
    next();
  });

  // Same-origin rule for state-changing requests.
  handlers.push((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.headers["origin"];
    if (origin) {
      try {
        const parsed = new URL(origin);
        const host = req.headers["host"] ?? "";
        if (parsed.host !== host) return next(errors.crossOrigin());
      } catch {
        return next(errors.crossOrigin());
      }
    }
    next();
  });

  return handlers;
}

export function requireAuth(): express.Handler {
  return (req, _res, next) => {
    if (!req.accountId) return next(errors.unauthenticated());
    next();
  };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string, expiresAtMs: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: config.signinSessionSeconds * 1000,
  });
}

export async function loadSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const account = await accountForSession(req.app.locals["db"] as Pool, token);
  if (account) req.accountId = account.id;
  next();
}
