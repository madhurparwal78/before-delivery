import type { ApiErrorBody, BrokenRule } from '../../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export const apiError = (
  status: number,
  code: string,
  message: string,
  extra?: { fields?: Record<string, string>; rules?: BrokenRule[]; hit_points?: number },
): ApiError => new ApiError(status, { error: code, message, ...extra });

export const payloadTooLarge = (): ApiError =>
  apiError(413, 'payload_too_large', 'The request body is larger than 65536 bytes.');

export const unsupportedMediaType = (): ApiError =>
  apiError(415, 'unsupported_media_type', 'The request body must be application/json.');

export const crossOrigin = (): ApiError =>
  apiError(403, 'cross_origin', 'Writes must come from this app.');

export const unauthenticated = (): ApiError =>
  apiError(401, 'unauthenticated', 'Sign in to do that.');

export const forbidden = (): ApiError =>
  apiError(403, 'forbidden', 'This account may not do that.');

export const notFound = (code = 'not_found', message = 'Not found.'): ApiError =>
  apiError(404, code, message);

export const validation = (fields: Record<string, string>): ApiError =>
  apiError(422, 'validation', 'Some fields need a change.', { fields });

export const rulesBroken = (rules: BrokenRule[]): ApiError =>
  apiError(422, 'rules_broken', rules.map((rule) => rule.message).join('; '), { rules });

export const conflict = (code: string, message: string): ApiError =>
  apiError(409, code, message);
