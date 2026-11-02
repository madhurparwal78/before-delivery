import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  override readonly message: string;
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
    this.message = message;
  }
}

export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export const ERR = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  forbidden: () => new ApiError(403, 'forbidden', "You don't have permission to do that."),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  methodNotAllowed: () => new ApiError(405, 'method_not_allowed', "This action isn't allowed."),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'Request body is too large.'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.'),
  validation: (fields: Record<string, string>, message = 'Check the highlighted fields.') =>
    new ApiError(422, 'validation', message, fields),
  tooDeep: () => new ApiError(422, 'validation', 'Request body is nested too deeply.'),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  unavailable: (code: string, message: string) => new ApiError(503, code, message),
  invalidTransition: (assetId: string, from: string, to: string) =>
    new ApiError(409, 'invalid_transition', `Cannot move ${assetId} from ${from} to ${to}.`),
  idempotencyConflict: () =>
    new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with a different request.'),
  idempotencyInProgress: () =>
    new ApiError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still in progress. Retry shortly.'),
} as const;

/** Sends the one published error shape; the single place an error reaches the wire. */
export function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    if (err.code === 'validation') {
      const fields = err.fields ?? {};
      res.status(err.status).json({ error: { code: err.code, message: err.message, fields } });
      return;
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('unexpected error', err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
