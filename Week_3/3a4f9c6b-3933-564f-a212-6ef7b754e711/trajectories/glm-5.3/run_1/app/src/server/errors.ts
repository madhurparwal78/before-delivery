import type { Response } from 'express';

// The single error shape. Every error response is built here.
export interface ApiError extends Record<string, unknown> {
  error: string;
  message: string;
}

export const ERROR_STATUS: Record<string, number> = {
  payload_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  request_key_required: 400,
  request_key_reused: 409,
  validation: 422,
  invalid_transition: 409,
  stage_busy: 409,
  not_verified_upstream: 409,
  version_exists: 409,
  evidence_pending: 409,
  approval_expired: 409,
  no_healthy_revision: 409,
  phase_regression: 409,
  promotion_not_running: 409,
  link_expired: 410,
  stale_version: 412,
  storage_unavailable: 503,
};

export class ApiErrorBody extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  send(res: Response): void {
    const status = ERROR_STATUS[this.code] ?? 400;
    const body: ApiError = { error: this.code, message: this.message, ...this.extra };
    res.status(status).json(body);
  }
}

export function validationError(fields: Record<string, string>): ApiErrorBody {
  return new ApiErrorBody('validation', 'The request is not valid.', { fields });
}

export function notFound(): ApiErrorBody {
  return new ApiErrorBody('not_found', 'The resource is unknown.');
}

export function forbidden(): ApiErrorBody {
  return new ApiErrorBody('forbidden', 'Your role in this project cannot do that.');
}
