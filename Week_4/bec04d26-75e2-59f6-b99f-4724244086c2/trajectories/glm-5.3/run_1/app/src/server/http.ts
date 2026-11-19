import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra?: Record<string, unknown>,
    public fieldErrors?: Record<string, string>,
  ) {
    super(code);
  }
}

/** Wrap an async route handler so rejections reach the error middleware. */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function notFound(): HttpError {
  return new HttpError(404, 'not_found');
}

export function forbidden(): HttpError {
  return new HttpError(403, 'forbidden');
}

export function validation(errors: Record<string, string>): HttpError {
  return new HttpError(422, 'invalid', undefined, errors);
}

