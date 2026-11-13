import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { AppError } from '../core/errors.js';
import { Db } from '../db/db.js';
import type { Settings, S3Config } from '../core/config.js';
import { StorageService } from '../services/storage.js';
import { liveLog, bus, type LiveMessage, type LiveType } from '../services/live.js';
import type { DbClient } from '../db/db.js';
import { newToken, sha256hex } from '../services/passwords.js';

export interface SessionUser {
  id: number;
  username: string;
  time_zone: string;
}

export class Ctx {
  readonly db: Db;
  readonly storage: StorageService;
  readonly settings: Settings;
  readonly s3: S3Config | null;
  clock: { nowMs: () => number; set: (ms: number) => void; advance: (ms: number) => void };

  constructor(opts: { db: Db; storage: StorageService; settings: Settings; s3: S3Config | null; clock: { nowMs: () => number; set: (ms: number) => void; advance: (ms: number) => void } }) {
    this.db = opts.db;
    this.storage = opts.storage;
    this.settings = opts.settings;
    this.s3 = opts.s3;
    this.clock = opts.clock;
  }

  now(): number {
    return this.clock.nowMs();
  }

  async live(c: PoolClient | DbClient, projectId: number, type: LiveType, data: Record<string, unknown>): Promise<number> {
    return liveLog.record(c as PoolClient, projectId, type, data, this.now());
  }

  async currentSeq(c: DbClient, projectId: number): Promise<number> {
    const r = await c.query<{ seq: string }>(`SELECT COALESCE(max(seq), 0) AS seq FROM live_messages WHERE project_id = $1`, [projectId]);
    return Number(r.rows[0]?.seq ?? 0);
  }

  subscribe(projectId: number, listener: (m: LiveMessage) => void): () => void {
    return bus.subscribe(projectId, listener);
  }
}

export interface RequestCtx {
  ctx: Ctx;
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  user: SessionUser | null;
  raw: Buffer;
  body: unknown;
  idemKey: string | null;
}

export type Handler = (rc: RequestCtx) => Promise<unknown>;

export function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

export function errorBody(code: string, message: string, details?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { error: code, message };
  if (details) out.details = details;
  return out;
}

export function sendError(res: ServerResponse, e: AppError): void {
  json(res, e.status, errorBody(e.code, e.message, e.details));
}

export function requireBody(rc: RequestCtx): Record<string, unknown> {
  if (rc.body === null || rc.body === undefined || typeof rc.body !== 'object' || Array.isArray(rc.body)) {
    throw new AppError(400, 'bad_request', "The request body isn't valid JSON.");
  }
  return rc.body as Record<string, unknown>;
}

export async function loadUser(ctx: Ctx, token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await ctx.db.query<{ id: number; username: string; time_zone: string; is_system: boolean }>(
    `SELECT u.id, u.username, u.time_zone, u.is_system FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  const row = r.rows[0];
  if (!row || row.is_system) return null;
  return { id: row.id, username: row.username, time_zone: row.time_zone };
}

export function newSessionToken(): string {
  return newToken();
}

export function hashing(value: string): string {
  return sha256hex(value);
}
