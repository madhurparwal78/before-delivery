import type { Response } from 'express';
import type { Pool } from 'pg';

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body['error'] ?? 'error'));
    this.status = status;
    this.body = body;
  }
}

export function unauthenticated(): ApiError { return new ApiError(401, { error: 'unauthenticated' }); }
export function notFound(): ApiError { return new ApiError(404, { error: 'not_found' }); }
export function forbidden(message: string): ApiError { return new ApiError(403, { error: 'forbidden', message }); }
export function conflict(error: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(409, { error, ...extra });
}
export function fieldErrors(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}
export function tooLarge(): ApiError { return new ApiError(413, { error: 'too_large' }); }
export function storageUnavailable(): ApiError { return new ApiError(503, { error: 'storage_unavailable' }); }
export function databaseUnavailable(): ApiError { return new ApiError(503, { error: 'database_unavailable' }); }

export function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/database|ECONNREFUSED|connection terminated|SASL|password authentication/i.test(message)) {
    res.status(503).json({ error: 'database_unavailable' });
    return;
  }
  console.error('unexpected error:', err);
  res.status(500).json({ error: 'internal_error' });
}

export function wrapDb<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => { throw databaseUnavailable(); });
}

export function dbDown(pool: Pool): boolean {
  return (pool as unknown as { _allConnectionsFailed?: boolean })._allConnectionsFailed === true;
}
