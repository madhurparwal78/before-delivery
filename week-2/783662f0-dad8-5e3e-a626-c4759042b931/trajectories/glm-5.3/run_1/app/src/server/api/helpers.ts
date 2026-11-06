/** Shared route helpers: body parsing, field checks, session and server contexts. */

import type { Pool } from "../db/pool.js";
import type { Request, Response } from "express";
import { apiError, type ApiError } from "./errors.js";
import { sendError } from "./boundary.js";
import * as ctx from "./context.js";
import { FieldCopy } from "../../shared/copy.js";

export type Body = Record<string, unknown>;

export function bodyOf(req: Request): Body {
  const b = req.body as Body | undefined;
  return b === undefined || b === null ? {} : b;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The unknown-field rule: the first unknown field in body order answers 422. */
export function checkFields(res: Response, b: Body, allowed: string[]): string | null {
  for (const key of Object.keys(b)) {
    if (!allowed.includes(key)) {
      sendError(res, apiError(422, "unknown_field", `Unknown field: ${key}`, { fields: { [key]: FieldCopy.unknown } }));
      return key;
    }
  }
  return null;
}

export function bad(res: Response, status: number, code: string, message: string, fields?: Record<string, string>): void {
  sendError(res, apiError(status, code, message, fields !== undefined ? { fields } : undefined));
}

/** The signed-in user, or the 401 error. */
export async function userCtx(pool: Pool, req: Request): Promise<ctx.SessionUserLike | ApiError> {
  return ctx.requireUser(pool, req);
}

export function isUser(value: ctx.SessionUserLike | ApiError): value is ctx.SessionUserLike {
  return (value as ctx.SessionUserLike).id !== undefined;
}

/** The member server context for :slug routes. */
export async function serverCtx(pool: Pool, req: Request): Promise<ctx.ServerContext | ApiError> {
  return ctx.serverContext(pool, req);
}

export function isServerCtx(value: ctx.ServerContext | ApiError): value is ctx.ServerContext {
  return (value as ctx.ServerContext).server !== undefined;
}
