import express, { type Request, type Response, type NextFunction, type RequestHandler, type Router } from "express";
import type { Sql } from "./db.js";
import { ApiError, errors } from "./errors.js";
import type { PersonRow } from "./domain/essays.js";

// Request context typed without any escapes.
export interface AppRequest extends Request {
  person?: PersonRow;
  rawBody?: unknown;
}

export const jsonLimit = 65536;

export function asyncHandler(fn: (req: AppRequest, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req as AppRequest, res, next).catch(next);
  };
}

// Wraps every handler a route module registers, so a rejected promise reaches
// the error middleware instead of crashing the process.
export function wrapRouter(router: Router): Router {
  const wrap = (fn: unknown): unknown => {
    if (typeof fn !== "function" || fn.length > 3) return fn;
    const wrapper = (req: Request, res: Response, next: NextFunction): unknown => {
      try {
        const result = (fn as (req: Request, res: Response, next: NextFunction) => unknown)(req, res, next);
        if (result instanceof Promise) return result.catch((err: unknown) => next(err));
        return result;
      } catch (err) {
        next(err);
        return undefined;
      }
    };
    return wrapper;
  };
  const patched = Object.create(router) as Router & Record<string, unknown>;
  for (const method of ["get", "post", "put", "patch", "delete", "use"]) {
    const original = (router as unknown as Record<string, (...args: unknown[]) => unknown>)[method].bind(router);
    patched[method] = (...args: unknown[]): unknown => {
      const handlers = args.map((a) => (typeof a === "function" ? wrap(a) : a));
      return original(...handlers);
    };
  }
  return patched;
}

export function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function etag(version: number): string {
  return `"${version}"`;
}

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json(err.body());
}

export function requirePerson(req: AppRequest): PersonRow {
  if (!req.person) throw errors.unauthenticated();
  return req.person;
}

export function role(person: PersonRow, ...roles: string[]): void {
  if (!roles.includes(person.role)) throw errors.forbidden();
}

// One error path for every route: an ApiError answers its own status and shape;
// connection-level Postgres errors mean the database is unreachable.
export function handleRouteError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body());
    return;
  }
  const pgErr = err as { code?: string };
  if (pgErr.code === "ECONNREFUSED" || pgErr.code === "ETIMEDOUT" || pgErr.code === "ECONNRESET" || pgErr.code === "ENOTFOUND" || pgErr.code === "28P01" || pgErr.code === "3D000") {
    res.status(503).json(errors.databaseUnavailable().body());
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Something went wrong on Saltprint Desk." } });
}

export function isNewsroomRole(person: PersonRow): boolean {
  return person.role === "picture_editor" || person.role === "licensing_manager";
}

export async function withDatabase(sql: Sql, res: Response, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
      return;
    }
    // Connection-level Postgres errors mean the database is unreachable.
    const pgErr = err as { code?: string };
    if (pgErr.code === "ECONNREFUSED" || pgErr.code === "ETIMEDOUT" || pgErr.code === "ECONNRESET" || pgErr.code === "ENOTFOUND" || pgErr.code === "28P01" || pgErr.code === "3D000") {
      sendError(res, errors.databaseUnavailable());
      return;
    }
    throw err;
  }
}
