import type { IncomingMessage, ServerResponse } from 'node:http';

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  override readonly message: string;
  readonly fields: FieldErrors | undefined;
  readonly extra: Record<string, unknown> | undefined;

  override readonly name = 'AppError';

  constructor(status: number, code: string, message: string, opts: { fields?: FieldErrors; extra?: Record<string, unknown> } = {}) {
    super(`${code}: ${message}`);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = opts.fields;
    this.extra = opts.extra;
  }

  static unauthenticated(): AppError {
    return new AppError(401, 'unauthenticated', 'Sign in to continue.');
  }

  static forbidden(): AppError {
    return new AppError(403, 'forbidden', 'You are not allowed to do that.');
  }

  static notFound(): AppError {
    return new AppError(404, 'not_found', 'Not found.');
  }

  static payloadTooLarge(): AppError {
    return new AppError(413, 'payload_too_large', 'That upload is too large.');
  }

  static unsupportedMedia(): AppError {
    return new AppError(415, 'unsupported_media_type', 'Send JSON or multipart form data.');
  }

  static versionRequired(): AppError {
    return new AppError(428, 'version_required', 'Send the piece version in If-Match.');
  }

  static versionConflict(current: number): AppError {
    return new AppError(412, 'version_conflict', 'This piece changed in another tab. Reload to see the current version.', { extra: { current_version: current } });
  }

  static invalidTransition(): AppError {
    return new AppError(409, 'invalid_transition', 'That move is not allowed.');
  }

  static validation(fields: FieldErrors): AppError {
    return new AppError(422, 'validation_failed', 'Some fields need a second look.', { fields });
  }

  static insufficientCredits(needed: number, available: number): AppError {
    return new AppError(402, 'insufficient_credits', 'This render needs more credits.', { extra: { needed, available } });
  }

  static providerUnavailable(): AppError {
    return new AppError(503, 'provider_unavailable', 'The shader assistant is offline.');
  }

  static providerMalformed(): AppError {
    return new AppError(502, 'provider_malformed', 'The shader assistant sent something unusable.');
  }

  static paymentsUnavailable(): AppError {
    return new AppError(503, 'payments_unavailable', 'Payments are offline right now.');
  }

  static storageUnavailable(): AppError {
    return new AppError(503, 'storage_unavailable', 'File storage is offline.');
  }
}

export function sendError(res: ServerResponse, err: AppError): void {
  const body: Record<string, unknown> = { error: { code: err.code, message: err.message } };
  if (err.extra) for (const [k, v] of Object.entries(err.extra)) (body.error as Record<string, unknown>)[k] = v;
  if (err.fields && err.status === 422) (body.error as Record<string, unknown>).fields = err.fields;
  sendJson(res, err.status, body, { 'Cache-Control': 'no-store' });
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string | undefined> = {}): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders
  });
  res.end(payload);
}

export function bodyText(req: IncomingMessage): string {
  return (req as unknown as { __bodyText?: string }).__bodyText ?? '';
}

export function setBodyText(req: IncomingMessage, text: string): void {
  (req as unknown as { __bodyText?: string }).__bodyText = text;
}
