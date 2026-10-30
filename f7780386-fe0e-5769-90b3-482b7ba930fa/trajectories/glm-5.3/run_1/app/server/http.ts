// HTTP layer: session cookie, the one error shape, the size and origin
// boundary, and JSON body handling. Routes live in api/*.ts.

import type { Request, Response } from 'express';
import { pool } from './db.js';
import { userFromRow } from './domain.js';
import { MAX_JSON_BYTES, SESSION_COOKIE } from '../shared/constants.js';
import type { User } from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errors?: Record<string, string>,
  ) {
    super(code);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated');
export const notFound = () => new ApiError(404, 'not_found');
export const forbidden = () => new ApiError(403, 'forbidden');
export const conflict = (code: string) => new ApiError(409, code);
export const validationFailed = (errors: Record<string, string>) => new ApiError(422, 'validation_failed', errors);
export const unavailable = (code: string) => new ApiError(503, code);

export function sendError(res: Response, err: ApiError): void {
  if (err.errors) {
    res.status(err.status).json({ error: err.code, errors: err.errors });
  } else {
    res.status(err.status).json({ error: err.code });
  }
}

// ---------------------------------------------------------------------------
// Sessions.
// ---------------------------------------------------------------------------

export interface SessionUser extends User {}

export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = sessionToken(req);
  if (token === null) return null;
  const q = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.member_id, m.business_name
     FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN members m ON m.id = u.member_id
     WHERE s.token = $1`,
    [token],
  );
  const row = q.rows[0] as Parameters<typeof userFromRow>[0] | undefined;
  if (!row) return null;
  return userFromRow(row);
}

/** Reads the session token from the Cookie header. */
export function sessionToken(req: Request): string | null {
  const header = req.headers['cookie'];
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw unauthenticated();
  return user;
}

export function requireMember(user: SessionUser): SessionUser & { member_id: string } {
  if (user.role !== 'member' || !user.member_id) throw forbidden();
  return user as SessionUser & { member_id: string };
}

export function requireOperator(user: SessionUser): SessionUser {
  if (user.role !== 'operator') throw forbidden();
  return user;
}

export function requireCrewCook(user: SessionUser): SessionUser & { member_id: string } {
  if (user.role !== 'crew_cook' || !user.member_id) throw forbidden();
  return user as SessionUser & { member_id: string };
}

// ---------------------------------------------------------------------------
// Request boundary.
// ---------------------------------------------------------------------------

export function originAllowed(req: Request, origin: string): boolean {
  const header = req.headers.origin;
  if (header === undefined) return true;
  return header === origin;
}

export function readJsonBody(req: Request): Promise<unknown> {
  if (req.rawBody) {
    return parseJson(req.rawBody.toString('utf8'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        // Keep draining the stream so the 413 response can be sent.
        refused = true;
        chunks.length = 0;
        reject(new ApiError(413, 'payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!refused) resolve(parseJson(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => {
      if (!refused) reject(new ApiError(400, 'bad_request'));
    });
  });
}

function parseJson(raw: string): Promise<unknown> {
  if (raw === '') return Promise.resolve({});
  try {
    return Promise.resolve(JSON.parse(raw));
  } catch {
    return Promise.reject(validationFailed({ body: 'invalid_json' }));
  }
}

/** Reads the raw bytes of an upload, within the published limit. */
export function readRawBody(req: Request, limit: number): Promise<Buffer> {
  if (req.rawBody) {
    if (req.rawBody.length > limit) {
      return Promise.reject(new ApiError(413, 'payload_too_large'));
    }
    return Promise.resolve(req.rawBody);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > limit) {
        refused = true;
        chunks.length = 0;
        reject(new ApiError(413, 'payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!refused) reject(new ApiError(400, 'bad_request'));
    });
  });
}

// ---------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validationFailed({ body: 'invalid' });
  }
  return value as Record<string, unknown>;
}

export function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw validationFailed({ [field]: 'invalid' });
  return value;
}

export function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const epoch = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(epoch);
}

export function dateFromRecord(record: Record<string, unknown>, field: string): string {
  const value = requireString(record, field);
  if (!isValidDate(value)) throw validationFailed({ [field]: 'invalid' });
  return value;
}
