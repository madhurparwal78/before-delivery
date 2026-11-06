import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Config } from '../../config';
import type { KillBillClient } from '../../services/killbill';
import type { OutboxService } from '../../services/outbox';
import type { StatusService } from '../../services/status';
import type { MailService } from '../../services/mail';
import { ApiError, sendError } from '../errors';
import type { CookiedRequest } from '../scope';

export interface AppServices {
  cfg: Config;
  kb: KillBillClient;
  mail: MailService;
  outbox: OutboxService;
  status: StatusService;
}

/**
 * Wraps a route so every ApiError answers with the one error shape in the
 * request locale, and unexpected failures answer as a plain 500 without
 * leaking internals.
 */
export function handler(
  fn: (req: CookiedRequest, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req as CookiedRequest, res))
      .then(() => {
        if (!res.writableEnded) next(new Error('route did not respond'));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          const locale = req.scope?.locale ?? 'fr';
          sendError(res, locale, err);
          return;
        }
        next(err);
      });
  };
}

/** The one route-parameter helper: Express types allow arrays here. */
export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

/** Reads the parsed JSON body as a fixed shape. */
export function bodyOf<T>(req: CookiedRequest): T {
  return (req.scope?.json<T>() ?? {}) as T;
}

export function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function noContent(res: Response): void {
  res.status(204).end();
}
