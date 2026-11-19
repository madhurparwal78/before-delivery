import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../errors.js';

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.send(JSON.stringify(body));
}

export function sendNoContent(res: Response, status: number): void {
  res.status(status);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** Turns every error into the single error body from the API. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body());
    return;
  }
  process.stderr.write(`unhandled server error: ${String(error)}\n`);
  sendJson(res, 500, {
    error: { code: 'internal_error', message: 'Something went wrong on our side.' },
  });
}
