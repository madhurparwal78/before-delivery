import { Response } from 'express';
import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'error');
    this.status = status;
    this.body = body;
  }
}

export const errors = {
  crossOrigin: () => new ApiError(403, { error: 'cross_origin' }),
  payloadTooLarge: () => new ApiError(413, { error: 'payload_too_large' }),
  unsupportedMediaType: () => new ApiError(415, { error: 'unsupported_media_type' }),
  unauthenticated: () => new ApiError(401, { error: 'unauthenticated' }),
  notFound: () => new ApiError(404, { error: 'not_found' }),
  idempotencyKeyReused: () => new ApiError(422, { error: 'idempotency_key_reused' }),
  notConnected: () => new ApiError(403, { error: 'not_connected' }),
  notPoster: () => new ApiError(403, { error: 'not_poster' }),
  notApplicant: () => new ApiError(403, { error: 'not_applicant' }),
  notAuthor: () => new ApiError(403, { error: 'not_author' }),
  notAdmin: () => new ApiError(403, { error: 'not_admin' }),
  ownProfile: () => new ApiError(403, { error: 'own_profile' }),
  validation: (fields: Record<string, string>) => new ApiError(422, { error: 'validation', fields }),
  storageUnavailable: () => new ApiError(503, { error: 'storage_unavailable' }),
};

export const conflict = (body: Record<string, unknown>): ApiError => new ApiError(409, body);

export const sendError = (res: Response, err: unknown): void => {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body);
    return;
  }
  res.status(500).json({ error: 'internal' });
};

export const newId = (): string => randomUUID().replace(/-/g, '');
