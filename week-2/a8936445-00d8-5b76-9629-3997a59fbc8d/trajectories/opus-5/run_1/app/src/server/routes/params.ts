import { errors } from '../http/errors.js';

export function stringField(
  body: Record<string, unknown>,
  name: string,
  fallback?: string,
): string {
  const value = body[name];
  if (typeof value === 'string') return value;
  if (value === undefined && fallback !== undefined) return fallback;
  throw errors.validation({ [name]: 'Give a value.' });
}

export function optionalString(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  throw errors.validation({ [name]: 'Give a value.' });
}

export function integerField(
  body: Record<string, unknown>,
  name: string,
  fallback?: number,
): number {
  const value = body[name];
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (value === undefined && fallback !== undefined) return fallback;
  throw errors.validation({ [name]: 'Give a whole number.' });
}

export function queryValue(query: URLSearchParams, name: string): string | null {
  const value = query.get(name);
  return value === null || value === '' ? null : value;
}
