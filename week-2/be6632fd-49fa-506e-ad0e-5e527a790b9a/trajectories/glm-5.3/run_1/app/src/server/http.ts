import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, NOT_FOUND_BODY, errorBody } from '../domain/errors.js';
import type { Config } from './providers.js';
import type { Db } from './db.js';
import type { PoolClient } from 'pg';

export interface MemberRow {
  id: string; workspace_id: string; name: string; email: string; role: string; stockist_id: string | null; created_at: Date;
}

export interface Session {
  member: MemberRow;
  workspace: { id: string; name: string };
  sessionId: string;
}

export type Ctx = {
  cfg: Config;
  db: Db;
  req: FastifyRequest;
  session: Session | null;
};

export function sendError(reply: FastifyReply, err: unknown, allow?: string): void {
  if (err instanceof ApiError) {
    const body = errorBody(err);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (err.retryAfterSeconds !== undefined) headers['retry-after'] = String(err.retryAfterSeconds);
    if (allow) headers.allow = allow;
    reply.code(err.status).headers(headers).send(body);
    return;
  }
  const body = Buffer.from(JSON.stringify({ error: { code: 'unreachable', message: "Hourline can't be reached. Nothing was saved. Check your connection and try again." } }));
  reply.code(503).header('content-type', 'application/json').send(body);
}

export function json(reply: FastifyReply, status: number, obj: unknown): void {
  reply.code(status).header('content-type', 'application/json').send(obj);
}

export function jsonBytes(reply: FastifyReply, status: number, bytes: Buffer, contentType = 'application/json'): void {
  reply.code(status).header('content-type', contentType).send(bytes);
}

// The app's own origin: either the origin of APP_PUBLIC_URL or its scheme with the
// request's own Host header.
export function ownOrigins(cfg: Config, req: FastifyRequest): string[] {
  let origin = '';
  try { origin = new URL(cfg.appPublicUrl).origin; } catch { origin = cfg.appPublicUrl; }
  let scheme = 'http';
  try { scheme = new URL(cfg.appPublicUrl).protocol.replace(':', ''); } catch { scheme = 'http'; }
  const host = req.headers.host ?? '';
  const origins = new Set<string>([origin]);
  if (host) origins.add(`${scheme}://${host}`);
  origins.add(`${scheme}://127.0.0.1:${cfg.port}`);
  origins.add(`${scheme}://localhost:${cfg.port}`);
  return [...origins];
}

export function isCrossOriginWrite(cfg: Config, req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  return !ownOrigins(cfg, req).includes(origin);
}

export function nowDate(): Date {
  return new Date();
}

export type Tx = PoolClient;
