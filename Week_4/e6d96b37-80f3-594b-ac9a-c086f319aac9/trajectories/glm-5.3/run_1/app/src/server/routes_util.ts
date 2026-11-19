import type { Request, Response } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import type { DeskEvent } from "../shared/types.js";
import { DomainError, errors } from "./domain.js";
import { broadcast } from "./hub.js";
import { stepUpFresh, type Session } from "./session.js";

export interface RouteContext {
  env: FlanEnv;
}

export function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function errorOut(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    if (err.failure.body.retry_after_seconds !== undefined) {
      res.setHeader("Retry-After", String(err.failure.body.retry_after_seconds));
    }
    json(res, err.failure.status, err.failure.body);
    return;
  }
  json(res, 503, { error: "service_unavailable", message: copyFor("F_SERVICE") });
}

export async function requireDealer(req: Request): Promise<Session> {
  const session = req.session;
  if (!session) throw errors.session();
  if (session.role !== "dealer") throw errors.hidden();
  return session;
}

export async function requireParty(req: Request): Promise<Session> {
  const session = req.session;
  if (!session) throw errors.session();
  if (session.role !== "dealer" && session.role !== "counterpart") throw errors.hidden();
  return session;
}

export async function requireCounterpart(req: Request): Promise<Session> {
  const session = req.session;
  if (!session) throw errors.session();
  if (session.role !== "counterpart") throw errors.forbidden();
  return session;
}

export function requireStepUp(req: Request): void {
  const session = req.session;
  const env = req.app.locals.env as FlanEnv;
  if (!session) throw errors.session();
  if (!stepUpFresh(session, env)) throw errors.stepUp();
}

export function parseJsonBody(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw errors.invalid({});
  return raw as Record<string, unknown>;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return undefined;
    out.push(item);
  }
  return out;
}

export interface Handled {
  status: number;
  body: unknown;
}

/** Runs a command handler and renders the single published error shape on failure. */
export async function guarded(res: Response, fn: () => Promise<Handled>): Promise<void> {
  try {
    const result = await fn();
    if (result.status === 204) {
      res.status(204).end();
      return;
    }
    json(res, result.status, result.body);
  } catch (err) {
    errorOut(res, err);
  }
}

/** Broadcasts an event to open screens once its transaction has committed. */
export function broadcastLater(ns: string, event: DeskEvent): void {
  queueMicrotask(() => broadcast(ns, event));
}
