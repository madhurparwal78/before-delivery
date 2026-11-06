import type { Request, Response } from 'express';
import { ApiError, errorCopy, type ErrorCode } from './errors.js';

export const JSON_BODY_LIMIT = 100_000;
export const UPLOAD_BODY_LIMIT = 5_200_000;

/**
 * The cross-site decision on state-changing requests: the one place that
 * decides. Covers every method other than GET and HEAD on any path under
 * /api, published or not.
 */
export function isCrossSite(req: Request): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const ownOrigin = `http://${host}`;
  const origin = req.headers.origin;
  const secFetchSite = req.headers['sec-fetch-site'];
  const referer = req.headers.referer;
  if (typeof origin === 'string') {
    if (origin === 'null') return true;
    if (origin !== ownOrigin) return true;
    return false;
  }
  if (typeof secFetchSite === 'string') {
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') return false;
    return true;
  }
  if (typeof referer === 'string') {
    try {
      const url = new URL(referer);
      const refererOrigin = `${url.protocol}//${url.host}`;
      return refererOrigin !== ownOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

export function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

export function inspectorHeaders(res: Response): void {
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function sendError(res: Response, status: number, code: ErrorCode, message: string, extra?: Record<string, unknown>, headers?: Record<string, string>): void {
  const body: Record<string, unknown> = { error: code, message };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (!(k in body)) body[k] = v;
    }
  }
  if (headers) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  }
  noStore(res);
  res.status(status).json(body);
}

export function apiError(res: Response, err: ApiError): void {
  sendError(res, err.status, err.code, err.message, err.extra);
}

export function validationFailed(errors: Record<string, string>): ApiError {
  return new ApiError('validation_failed', { errors });
}

export { errorCopy };
