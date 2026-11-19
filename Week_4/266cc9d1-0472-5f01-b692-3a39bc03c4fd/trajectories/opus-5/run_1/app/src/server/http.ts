/**
 * The request pipeline. One place reads bodies, authenticates, replays
 * idempotent requests and decides the error precedence order.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "./config.js";
import {
  ApiError,
  crossOrigin,
  forbidden,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
} from "./errors.js";
import { StorageUnreachable } from "./services/storage.js";
import { storageUnavailable } from "./errors.js";
import { replayOrRun } from "./domain/idempotency.js";
import { authenticateReview, authenticateStaff, type ReviewAuth, type StaffAuth } from "./auth.js";

export interface RouteContext<A> {
  req: Request;
  res: Response;
  auth: A;
  body: unknown;
  params: Record<string, string>;
}

export interface RouteResult {
  status: number;
  body?: unknown;
  /** Raw byte responses (file reads and the evidence pack). */
  raw?: { bytes: Uint8Array; headers: Record<string, string>; status: number };
  headers?: Record<string, string>;
}

type AuthKind = "none" | "staff" | "review";

type AuthFor<K extends AuthKind> = K extends "staff"
  ? StaffAuth
  : K extends "review"
    ? ReviewAuth
    : null;

export interface RouteSpec<K extends AuthKind, C> {
  auth: K;
  /** Maximum JSON body size. File uploads declare their own larger limit. */
  bodyLimit?: number;
  /** Raw byte bodies skip the JSON content-type requirement. */
  rawBody?: boolean;
  mutating?: boolean;
  idempotencyRoute?: string;
  load?: (context: RouteContext<AuthFor<K>>) => Promise<C>;
  role?: (context: RouteContext<AuthFor<K>>, loaded: C) => void;
  handle: (context: RouteContext<AuthFor<K>>, loaded: C) => Promise<RouteResult>;
}

const GLOBAL_MAX_BODY = 50_000_000;

function readRawBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.byteLength;
      if (length > limit) {
        settled = true;
        req.pause();
        reject(payloadTooLarge(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function mediaType(req: Request): string | null {
  const header = req.headers["content-type"];
  if (typeof header !== "string" || header.trim() === "") return null;
  return header.split(";")[0].trim().toLowerCase();
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "" || origin === "null") return true;
  const allowed = new Set<string>([config.publicUrl]);
  const host = req.headers.host;
  if (typeof host === "string") {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  return allowed.has(origin.replace(/\/+$/, ""));
}

function idempotencyKey(req: Request): string | null {
  const header = req.headers["idempotency-key"];
  if (typeof header !== "string") return null;
  if (header.length < 1 || header.length > 128) return null;
  return /^[\x21-\x7e]+$/.test(header) ? header : null;
}

export function defineRoute<K extends AuthKind, C = undefined>(
  spec: RouteSpec<K, C>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = spec.bodyLimit ?? GLOBAL_MAX_BODY;
      let body: unknown = {};

      if (spec.rawBody) {
        body = await readRawBody(req, limit);
      } else {
        const type = mediaType(req);
        if (type !== null && type !== "application/json") throw unsupportedMediaType();
        const raw = await readRawBody(req, limit);
        if (raw.byteLength === 0) {
          body = {};
        } else {
          try {
            body = JSON.parse(raw.toString("utf8")) as unknown;
          } catch {
            throw new ApiError(422, "validation_failed", "Send a JSON object.", { fields: {} });
          }
        }
      }

      const auth = (
        spec.auth === "staff"
          ? await authenticateStaff(req)
          : spec.auth === "review"
            ? await authenticateReview(req)
            : null
      ) as AuthFor<K>;

      const context: RouteContext<AuthFor<K>> = {
        req,
        res,
        auth,
        body,
        params: req.params as Record<string, string>,
      };

      const run = async (): Promise<RouteResult> => {
        const loaded = spec.load ? await spec.load(context) : (undefined as C);
        if (spec.mutating && !sameOrigin(req)) throw crossOrigin();
        if (spec.role) spec.role(context, loaded);
        return spec.handle(context, loaded);
      };

      const key = spec.idempotencyRoute ? idempotencyKey(req) : null;
      const result =
        key && spec.idempotencyRoute
          ? await replayOrRun(
              spec.auth === "review"
                ? `link:${(auth as ReviewAuth).link.id}`
                : `tenant:${(auth as StaffAuth).staff.tenant_id}`,
              spec.idempotencyRoute,
              key,
              body,
              run,
            )
          : await run();

      send(res, result);
    } catch (error) {
      next(error);
    }
  };
}

function send(res: Response, result: RouteResult): void {
  if (result.raw) {
    for (const [name, value] of Object.entries(result.raw.headers)) res.setHeader(name, value);
    res.status(result.raw.status).end(Buffer.from(result.raw.bytes));
    return;
  }
  for (const [name, value] of Object.entries(result.headers ?? {})) res.setHeader(name, value);
  if (result.body === undefined) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.body);
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json(notFound().body());
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const api =
    error instanceof ApiError
      ? error
      : error instanceof StorageUnreachable
        ? storageUnavailable()
        : null;
  if (api) {
    res.status(api.status).json(api.body());
    return;
  }
  console.error("unhandled request error", error);
  res.status(500).json(new ApiError(500, "internal_error", "Something went wrong.").body());
}

export function requireRole(auth: StaffAuth, role: StaffAuth["staff"]["role"], message: string): void {
  if (auth.staff.role !== role) throw forbidden(message);
}
