import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError, ValidationError, sendApiError, serviceDown } from './errors.js';
import { AddressRefused } from '../domain/safe-fetch.js';
import { BillingUnavailable } from '../services/killbill.js';
import { DocumentsUnavailable } from '../services/gotenberg.js';
import { MailUnavailable } from '../services/mail.js';
import { SignInUnavailable } from '../services/keycloak.js';
import { StorageUnavailable } from '../services/s3.js';
import { WebhooksUnavailable } from '../services/svix.js';
import { AlertsUnavailable } from '../services/ntfy.js';

/** Turn a provider's silence into the published 503 for that service. */
function asApiError(error: unknown): unknown {
  if (error instanceof BillingUnavailable) return serviceDown('killbill', 'billing_unavailable');
  if (error instanceof StorageUnavailable) return serviceDown('minio', 'storage_unavailable');
  if (error instanceof WebhooksUnavailable) return serviceDown('svix', 'webhooks_unavailable');
  if (error instanceof DocumentsUnavailable) {
    return serviceDown('gotenberg', 'documents_unavailable');
  }
  if (error instanceof MailUnavailable) return serviceDown('mailpit', 'mail_unavailable');
  if (error instanceof AlertsUnavailable) return serviceDown('ntfy', 'alerts_unavailable');
  if (error instanceof SignInUnavailable) return serviceDown('keycloak', 'signin_unavailable');
  if (error instanceof AddressRefused) return new ApiError(422, 'validation');
  if (isDatabaseDown(error)) return serviceDown('postgres', 'records_unavailable');
  return error;
}

function isDatabaseDown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === '57P01' ||
    code === '08006' ||
    code === '08003'
  );
}

export type AsyncHandler = (req: Request, res: Response) => Promise<void>;

/** Wrap a handler so every failure leaves through the one error shape. */
export function route(handler: AsyncHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      sendApiError(res, asApiError(error));
    });
  };
}

export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  return undefined;
}

export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

export function bodyObject(req: Request): Record<string, unknown> {
  const body = req.body as unknown;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

export { ValidationError };
