import type { IncomingMessage, ServerResponse } from 'node:http';

/** The single error shape. */
export interface ApiErrorBody {
  error: string;
}

export type ConflictCode =
  | 'bay_occupied'
  | 'bay_too_small'
  | 'bay_class_change'
  | 'car_released'
  | 'car_not_stored'
  | 'car_in_workshop'
  | 'release_already_open'
  | 'slot_taken'
  | 'invalid_transition'
  | 'estimate_expired'
  | 'estimate_changed_as_412'
  | 'stage_already_logged'
  | 'stage_out_of_order'
  | 'job_already_open'
  | 'report_already_signed'
  | 'insufficient_items'
  | 'belongings_checked_in'
  | 'invoice_unpaid'
  | 'already_paid'
  | 'idempotency_conflict';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra?: Record<string, unknown>,
    public validation?: Record<string, string>,
  ) {
    super(code);
  }
}

export const ERRORS = {
  unauthenticated: () => new ApiError(401, 'unauthenticated'),
  accessRevoked: () => new ApiError(401, 'access_revoked'),
  sessionExpired: () => new ApiError(401, 'session_expired'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials'),
  forbidden: () => new ApiError(403, 'forbidden'),
  notFound: () => new ApiError(404, 'not_found'),
  conflict: (code: string, extra?: Record<string, unknown>) => new ApiError(409, code, extra),
  estimateChanged: () => new ApiError(412, 'estimate_changed'),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type'),
  validation: (fields: Record<string, string>) => new ApiError(422, 'validation', undefined, fields),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable'),
  billingUnavailable: () => new ApiError(503, 'billing_unavailable'),
  mailUnavailable: () => new ApiError(503, 'mail_unavailable'),
};

export function writeError(res: ServerResponse, err: ApiError): void {
  if (res.headersSent) return;
  if (err.validation) {
    res.writeHead(err.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ errors: err.validation }));
    return;
  }
  const body: Record<string, unknown> = { error: err.code };
  if (err.extra) {
    for (const [key, value] of Object.entries(err.extra)) {
      body[key] = value;
    }
  }
  res.writeHead(err.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    const url = new URL(origin as string);
    return url.host === host;
  } catch {
    return false;
  }
}
