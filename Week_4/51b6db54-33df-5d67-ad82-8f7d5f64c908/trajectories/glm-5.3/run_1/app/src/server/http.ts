import express, { type Request, type Response, type NextFunction, type Express } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { q, one } from './db.js';
import { applySchema } from './schema.js';
import { readConfig, type Config } from './config.js';
import { now, nowMs } from './clock.js';
import {
  ApiError, unauthenticated, notFound, forbidden, conflict, fieldErrors, sendError
} from './errors.js';
import { randomToken, sixDigitCode, hashPassword, checkPassword, sha256Hex } from './config.js';

export const config: Config = readConfig();
export interface SessionUser { id: number; email: string; name: string; number_format: string; time_zone: string }

export interface AuthedRequest extends Request {
  user: SessionUser | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user: SessionUser | null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export async function loadSession(req: Request): Promise<SessionUser | null> {
  const token = parseCookies(req)['celmate_session'];
  if (!token) return null;
  const row = await one<{ id: string; email: string; name: string; number_format: string; time_zone: string }>(
    `select u.id::text, u.email, u.name, u.number_format, u.time_zone from sessions s
     join users u on u.id = s.user_id where s.token = $1`,
    [token]
  );
  if (!row) return null;
  return { id: Number(row.id), email: row.email, name: row.name, number_format: row.number_format, time_zone: row.time_zone };
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await loadSession(req);
  if (!user) throw unauthenticated();
  return user;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', `celmate_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', 'celmate_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/** Body reader honouring the published limits. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const limit = req.path === '/api/grading/seed' ? 20000000 : 1000000;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new ApiError(413, { error: 'too_large' });
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

/** Every response's number text follows the signed-in person's settings. */
export function userFormat(user: SessionUser | null): 'en-US' | 'en-IN' {
  return user?.number_format === 'en-IN' ? 'en-IN' : 'en-US';
}

export function err422Text(req: Request, user: SessionUser | null, text: string): string {
  return text;
}

export function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}
