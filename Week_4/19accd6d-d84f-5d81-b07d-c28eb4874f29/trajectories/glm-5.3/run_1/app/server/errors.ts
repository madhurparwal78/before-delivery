import type { NextFunction, RequestHandler, Response } from 'express';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated', 'Sign in first.');
export const notFound = () => new ApiError(404, 'not_found', 'Not found.');
export const forbidden = () => new ApiError(403, 'forbidden', 'You may not do this.');
export const validation = (fields: Record<string, string>) =>
  new ApiError(422, 'validation_failed', 'Some fields need attention.', { fields });
export const payloadTooLarge = (limit: number) =>
  new ApiError(413, 'payload_too_large', `The request body is larger than ${limit} bytes.`);
export const dependencyDown = (code: string, message: string) => new ApiError(503, code, message);

/** Every route runs through this so a rejected promise reaches the one error handler. */
export function handle<T extends RequestHandler>(fn: T): RequestHandler {
  return (req, res, next: NextFunction) => {
    void (fn(req as never, res as never, next as never) as unknown as Promise<unknown>).catch(next);
  };
}

export function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    return;
  }
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
}
