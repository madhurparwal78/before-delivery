import type { Request, Response } from 'express';
import { errorMessage, httpStatusFor, type ErrorCode } from '../domain/errors';
import type { Locale } from '../domain/model';
import { applyErrorParams } from '../domain/i18n';
import type { AccountRow } from '../services/store';

export interface ApiErrorShape {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

export const bodyLimitBytes = 16384;

/** The one locale rule: header, cookie, account, Accept-Language, else fr. */
export function requestLocale(req: Request, account: AccountRow | null): Locale {
  const header = req.headers['x-halide-locale'];
  if (typeof header === 'string') {
    const first = header.split(',')[0]?.trim().toLowerCase();
    if (first === 'en' || first === 'fr') return first;
    const raw = header.trim().toLowerCase();
    if (raw === 'en' || raw === 'fr') return raw;
  }
  const cookie = req.cookies?.halide_locale;
  if (cookie === 'en' || cookie === 'fr') return cookie;
  if (account && (account.locale === 'en' || account.locale === 'fr')) return account.locale;
  const accept = req.headers['accept-language'];
  if (typeof accept === 'string' && accept.trim().toLowerCase().startsWith('en')) return 'en';
  return 'fr';
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, options: {
    fields?: Record<string, string>;
    params?: Record<string, string>;
    extra?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}) {
    super(code);
    this.code = code;
    this.fields = options.fields;
    this.extra = options.extra;
    this.headers = options.headers;
    this.params = options.params;
  }

  private params?: Record<string, string>;

  body(locale: Locale): ApiErrorShape {
    const template = errorMessage[this.code][locale];
    const message = this.params ? applyErrorParams(template, this.params) : template;
    const error: ApiErrorShape['error'] = { code: this.code, message };
    if (this.fields) error.fields = this.fields;
    return { error };
  }

  status(): number {
    return httpStatusFor[this.code];
  }
}

export function sendError(res: Response, locale: Locale, err: ApiError): void {
  const status = err.status();
  const body = err.body(locale);
  const payload = { ...body };
  if (err.extra) {
    for (const [k, v] of Object.entries(err.extra)) {
      (payload.error as Record<string, unknown>)[k] = v;
    }
  }
  res.status(status);
  if (err.headers) {
    for (const [k, v] of Object.entries(err.headers)) res.set(k, v);
  }
  res.json(payload);
}

export const notFoundError = (): ApiError => new ApiError('not_found');
export const unauthenticatedError = (): ApiError => new ApiError('unauthenticated');
export const forbiddenError = (): ApiError => new ApiError('forbidden');
export const crossOriginError = (): ApiError => new ApiError('cross_origin');
export const validationError = (fields: Record<string, string>): ApiError => new ApiError('validation', { fields });
