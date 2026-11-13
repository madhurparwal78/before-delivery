import { validation } from './errors.js';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Obj = Record<string, unknown>;

/** The request body as an object; anything else reads as an empty object, so its fields fail validation. */
export const asObject = (body: unknown): Obj => (typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Obj) : {});

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const wholeNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null);

export const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** Throws the 422 for the collected field errors, if there are any. */
export const failOn = (fields: Record<string, string>): void => {
  if (Object.keys(fields).length > 0) throw validation(fields);
};
