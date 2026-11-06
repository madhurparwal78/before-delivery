import type { Response } from 'express';

// All API errors use the one shape from the brief, built here.
export function errorBody(field: string, message: string): { errors: { [k: string]: string } } {
  return { errors: { [field]: message } };
}

export function sendError(res: Response, status: number, field: string, message: string): void {
  res.status(status).json(errorBody(field, message));
}

export const GENERIC = {
  unauthorised: { errors: { form: 'Sign in again.' } } as const,
  notFound: { errors: { form: 'Not found.' } } as const,
  unavailable: { errors: { form: 'The server is unavailable.' } } as const,
  crossOrigin: { errors: { form: 'Cross-origin requests are not allowed.' } } as const,
  tooLarge: { errors: { form: 'That request is too large.' } } as const,
  readOnly: { errors: { form: 'This link is read only.' } } as const,
};
