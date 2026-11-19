import type { Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import { settings } from './config';
import { serverNow } from './clock';
import { one, query, type Tx } from './db';
import { AppError, invalid } from './errors';
import type { Actor } from './auth';

export type Result = { status: number; body: unknown } | void;

export function route(handler: (request: Request, response: Response) => Promise<Result>): RequestHandler {
  return (request, response, next) => {
    handler(request, response)
      .then((result) => {
        if (response.headersSent) return;
        if (!result) {
          response.status(204).end();
          return;
        }
        response.status(result.status).json(result.body);
      })
      .catch((error) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        if (error instanceof AppError) {
          response.status(error.status).json(error.body);
          return;
        }
        next(error);
      });
  };
}

export function ok(body: unknown): Result {
  return { status: 200, body };
}

export function created(body: unknown): Result {
  return { status: 201, body };
}

export function body(request: Request): Record<string, unknown> {
  const value = request.body;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function requireString(source: Record<string, unknown>, field: string, max = 200): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(field, 'missing');
  if (value.trim().length > max) throw invalid(field);
  return value.trim();
}

export function requireInteger(
  source: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(field);
  }
  return value;
}

/** Looks a record up inside the caller's clinic; anything else is a missing record. */
export async function findInClinic<T>(
  table: string,
  id: unknown,
  clinicId: string,
  columns = '*',
): Promise<T> {
  if (typeof id !== 'string' || id.length === 0) throw new AppError('not_found');
  const row = await one<T>(`select ${columns} from ${table} where id = $1 and clinic_id = $2`, [
    id,
    clinicId,
  ]);
  if (!row) throw new AppError('not_found');
  return row;
}

export type PatientRecord = {
  id: string;
  name: string;
  species: string;
  client_id: string;
  weight_grams: number | null;
  photo_file_id: string | null;
};

export function findPatient(id: unknown, clinicId: string): Promise<PatientRecord> {
  return findInClinic<PatientRecord>('patients', id, clinicId);
}

export function hashBody(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

export type IdempotentReplay = { status: number; body: unknown } | null;

/**
 * Answers a remembered key with its stored response, or rejects the key when it
 * was used for a different request.
 */
export async function replayIdempotency(
  request: Request,
  clinicId: string,
): Promise<IdempotentReplay> {
  const key = request.header('Idempotency-Key');
  if (!key) return null;
  const record = await one<{
    method: string;
    path: string;
    body_hash: string;
    status: number;
    response: unknown;
    created_at: Date;
  }>('select method, path, body_hash, status, response, created_at from idempotency_records where clinic_id = $1 and key = $2', [
    clinicId,
    key,
  ]);
  if (!record) return null;
  const age = serverNow() - record.created_at.getTime();
  if (age > settings.idempotencyKeyHours * 3_600_000) {
    await query('delete from idempotency_records where clinic_id = $1 and key = $2', [clinicId, key]);
    return null;
  }
  if (
    record.method !== request.method ||
    record.path !== request.path ||
    record.body_hash !== hashBody(request.body)
  ) {
    throw new AppError('idempotency_key_reused');
  }
  return { status: record.status, body: record.response };
}

export async function rememberIdempotency(
  request: Request,
  clinicId: string,
  status: number,
  responseBody: unknown,
): Promise<void> {
  const key = request.header('Idempotency-Key');
  if (!key) return;
  await query(
    `insert into idempotency_records (clinic_id, key, method, path, body_hash, status, response, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (clinic_id, key) do nothing`,
    [
      clinicId,
      key,
      request.method,
      request.path,
      hashBody(request.body),
      status,
      JSON.stringify(responseBody),
      new Date(serverNow()).toISOString(),
    ],
  );
}

export async function actorName(tx: Tx, userId: string): Promise<string> {
  const row = await tx.one<{ name: string }>('select name from users where id = $1', [userId]);
  return row?.name ?? '';
}

export function actorOf(request: Request): Actor {
  const actor = (request as Request & { actor?: Actor }).actor;
  if (!actor) throw new AppError('unauthenticated');
  return actor;
}
