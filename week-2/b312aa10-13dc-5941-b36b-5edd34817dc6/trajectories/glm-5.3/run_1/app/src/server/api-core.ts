import type { Request, Response, NextFunction } from 'express';
import { getPool, withContentionRetry } from './db.js';
import { ApiError, errorCopy, STATUS_BY_CODE, type ErrorCode } from './errors.js';
import { isCrossSite, noStore, sendError } from './http.js';
import type { Caller, KitchenRow, PersonRow } from './context.js';
import type { PoolClient } from 'pg';

export interface AuthedRequest extends Request {
  caller?: Caller;
  rawBody?: Buffer;
  jsonBody?: unknown;
}

export function callerOf(req: AuthedRequest): Caller {
  if (!req.caller) throw new ApiError('unauthenticated');
  return req.caller;
}

export async function readJson(req: AuthedRequest): Promise<unknown> {
  return req.jsonBody;
}

export async function requireCaller(req: AuthedRequest): Promise<Caller> {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)lineboard_session=([A-Za-z0-9_-]+)/.exec(cookie);
  if (!match) throw new ApiError('unauthenticated');
  const pool = getPool();
  const result = await pool.query<{ id: string }>(`SELECT id FROM sessions WHERE id=$1`, [match[1]]);
  if (result.rows.length === 0) throw new ApiError('unauthenticated');
  return loadCallerFromSession(pool, match[1], req);
}

export async function loadCallerFromSession(pool: { connect(): Promise<PoolClient> }, sessionId: string, _req: AuthedRequest): Promise<Caller> {
  const client = await pool.connect();
  try {
    const personResult = await client.query<PersonRow & { kitchen_id: string }>(
      `SELECT p.* FROM people p JOIN sessions s ON s.person_id=p.id WHERE s.id=$1`,
      [sessionId],
    );
    if (personResult.rows.length === 0) throw new ApiError('unauthenticated');
    const person = personResult.rows[0];
    const kitchenResult = await client.query<KitchenRow>(`SELECT * FROM kitchens WHERE id=$1`, [person.kitchen_id]);
    return { person, kitchen: kitchenResult.rows[0] };
  } finally {
    client.release();
  }
}

/** The published route table: the one place that decides which /api requests answer 404. */
export function methodPathListed(method: string, path: string): boolean {
  return ROUTE_TABLE.some(([m, pattern]) => {
    if (m !== method) return false;
    const parts = pattern.split('/').filter(Boolean);
    const actual = path.split('/').filter(Boolean);
    if (parts.length !== actual.length) return false;
    return parts.every((p, i) => (p.startsWith('{') && p.endsWith('}') ? true : p === actual[i]));
  });
}

const ROUTE_TABLE: [string, string][] = [
  ['POST', '/api/session'],
  ['GET', '/api/session'],
  ['DELETE', '/api/session'],
  ['GET', '/api/kitchen'],
  ['GET', '/api/board'],
  ['GET', '/api/stations'],
  ['POST', '/api/stations/{stationId}/rates'],
  ['PUT', '/api/kitchen/peak-windows'],
  ['PUT', '/api/kitchen/document-requirements'],
  ['POST', '/api/bookings'],
  ['POST', '/api/bookings/{id}/confirm'],
  ['GET', '/api/bookings'],
  ['GET', '/api/bookings/{id}'],
  ['POST', '/api/bookings/{id}/cancel'],
  ['POST', '/api/bookings/{id}/check-in'],
  ['POST', '/api/bookings/{id}/check-out'],
  ['POST', '/api/bookings/{id}/no-show'],
  ['POST', '/api/bookings/{id}/move'],
  ['POST', '/api/bookings/{id}/release'],
  ['POST', '/api/bookings/{id}/waive-penalty'],
  ['POST', '/api/out-of-service'],
  ['DELETE', '/api/out-of-service/{id}'],
  ['GET', '/api/members'],
  ['GET', '/api/members/{memberId}'],
  ['PATCH', '/api/members/me'],
  ['GET', '/api/members/{memberId}/hour-bank'],
  ['GET', '/api/members/{memberId}/invoices/{month}'],
  ['POST', '/api/months/{month}/close'],
  ['GET', '/api/reports/utilisation'],
  ['GET', '/api/exports/usage.csv'],
  ['POST', '/api/documents'],
  ['GET', '/api/documents'],
  ['GET', '/api/documents/{id}'],
  ['GET', '/api/documents/{id}/file'],
  ['POST', '/api/documents/{id}/approve'],
  ['POST', '/api/sanitation-entries'],
  ['GET', '/api/sanitation-entries'],
  ['POST', '/api/sanitation-reports'],
  ['GET', '/api/sanitation-reports'],
  ['GET', '/api/sanitation-reports/{month}/file'],
  ['POST', '/api/inspector-links'],
  ['GET', '/api/inspector-links'],
  ['POST', '/api/inspector-links/{id}/regenerate'],
  ['DELETE', '/api/inspector-links/{id}'],
  ['GET', '/api/inspect/{token}'],
  ['GET', '/api/inspect/{token}/documents/{documentId}/file'],
  ['GET', '/api/inspect/{token}/sanitation-reports/{month}/file'],
  ['GET', '/api/service-status'],
  ['GET', '/api/health'],
];

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  void req;
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    sendError(res, err.status, err.code, err.message, err.extra);
    return;
  }
  sendError(res, 500, 'internal', errorCopy('internal'));
}

/** Rejects an unknown resource the same whether it belongs to another kitchen or does not exist. */
export function notFound(): ApiError {
  return new ApiError('not_found');
}

export function forbidden(): ApiError {
  return new ApiError('forbidden');
}

export function requireRole(caller: Caller, roles: PersonRow['role'][]): void {
  if (!roles.includes(caller.person.role)) throw forbidden();
}

export { STATUS_BY_CODE, isCrossSite, noStore, withContentionRetry };
export type { ErrorCode, PoolClient };
