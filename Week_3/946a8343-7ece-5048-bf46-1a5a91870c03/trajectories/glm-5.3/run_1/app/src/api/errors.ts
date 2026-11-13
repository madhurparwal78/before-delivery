import { AppError, type FieldErrors } from '../core/errors.js';

export function badRequest(): AppError {
  return new AppError(400, 'bad_request', "The request body isn't valid JSON.");
}

export function unauthenticated(): AppError {
  return new AppError(401, 'unauthenticated', 'Sign in to continue.');
}

export function notFound(): AppError {
  return new AppError(404, 'not_found', 'Not found.');
}

export function forbidden(): AppError {
  return new AppError(403, 'forbidden', "You don't have permission to do that.");
}

export function methodNotAllowed(): AppError {
  return new AppError(405, 'method_not_allowed', "This method isn't allowed here.");
}

export function rateLimited(seconds: number): AppError {
  return new AppError(429, 'rate_limited', `Too many requests. Try again in ${seconds} seconds.`);
}

export function payloadTooLarge(max: number): AppError {
  return new AppError(413, 'payload_too_large', `Request body is too large (${max} bytes at most).`);
}

export function validation(fields: FieldErrors): AppError {
  const first = Object.keys(fields)[0];
  const details = { fields };
  return new AppError(422, 'validation', fields[first], details);
}

export function validationMsg(message: string, field?: string): AppError {
  if (field) return new AppError(422, 'validation', message, { fields: { [field]: message } });
  return new AppError(422, 'validation', message);
}

export function conflict(code: string, message: string): AppError {
  return new AppError(409, code, message);
}

export function storageUnavailable(message: string): AppError {
  return new AppError(503, 'storage_unavailable', message);
}
