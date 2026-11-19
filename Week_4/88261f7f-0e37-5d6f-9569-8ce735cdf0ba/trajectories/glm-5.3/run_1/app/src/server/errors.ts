export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error: string } | { errors: Record<string, string> },
    public extra?: Record<string, unknown>
  ) {
    super('ApiError');
  }
}

export const err = {
  unauthorized: () => new ApiError(401, { error: 'Please sign in.' }),
  notFound: (text = 'Not found.') => new ApiError(404, { error: text }),
  conflict: (text: string) => new ApiError(409, { error: text }),
  validation: (field: string, message: string) =>
    new ApiError(422, { errors: { [field]: message } }),
  validations: (fields: Record<string, string>) => new ApiError(422, { errors: fields }),
  unavailable: (text: string) => new ApiError(503, { error: text }),
  tooLarge: () => new ApiError(413, { error: 'That request is too large.' }),
  sendJson: () => new ApiError(415, { error: 'Send JSON.' }),
  tooLargePhoto: () => new ApiError(413, { error: 'That photo is too large.' }),
  wrongPhotoType: () => new ApiError(415, { error: 'Please upload a JPEG or PNG photo.' }),
  photoStoreUnavailable: () => new ApiError(503, { error: 'Your photo could not be saved. Please try again.' })
};

export const linkNotFound = () => new ApiError(404, { error: 'This check-in link is no longer valid.' });

import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wrap an async route so rejections reach the error handler. */
export function route(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
