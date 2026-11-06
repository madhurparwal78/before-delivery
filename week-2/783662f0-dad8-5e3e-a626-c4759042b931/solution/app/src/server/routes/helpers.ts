import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../errors.js';

type Handler = (req: Request, res: Response) => Promise<void>;

/** Wraps a handler so that every refusal reaches the one error builder. */
export const route =
  (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      sendError(res, error);
    });
  };

const json = (res: Response, status: number, body: unknown): void => {
  res.status(status).type('application/json; charset=utf-8').send(JSON.stringify(body));
};

export const ok = (res: Response, body: unknown): void => json(res, 200, body);
export const created = (res: Response, body: unknown): void => json(res, 201, body);
export const noContent = (res: Response): void => {
  res.status(204).end();
};

export const body = (req: Request): Record<string, unknown> => req.jsonBody ?? {};

export const queryString = (req: Request, name: string): string | undefined => {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
};
