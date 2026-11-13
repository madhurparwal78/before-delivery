import type { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorBody(err: AppError): Record<string, unknown> {
  const error: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.fields && Object.keys(err.fields).length > 0) error.fields = err.fields;
  if (err.details && Object.keys(err.details).length > 0) error.details = err.details;
  return { error };
}

export const notFound = (message = "We couldn't find that page") =>
  new AppError(404, 'not_found', message);

export const linkNotFound = () => new AppError(404, 'link_not_found', 'This link no longer works.');

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
