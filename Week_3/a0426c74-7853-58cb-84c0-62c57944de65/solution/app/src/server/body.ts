import * as copy from '../shared/copy.ts';
import { ApiError, invalid } from '../shared/errors.ts';
import { isJson, type Json } from '../shared/model/read.ts';

/** A request body that is a JSON object. */
export type Body = Json;

/** The JSON body as an object; `invalid` when it is an array, a number or null. */
export function objectBody(value: unknown): Body {
  if (!isJson(value)) throw invalid(copy.NOT_JSON);
  return value;
}

/** A field that must be a string; anything else reads as the empty string, which every caller's own rule then refuses. */
export function stringField(body: Body, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value : '';
}

/** A null character, or a surrogate half that is not part of a pair (with the `u` flag a pair reads as one character). */
const UNSTORABLE_CHARACTER = /\0|\p{Surrogate}/u;

/**
 * Throws `invalid` when the JSON holds text that PostgreSQL cannot store: a null character or an unpaired surrogate, in a string or
 * a key. Walks with its own stack, so a deeply nested body cannot overflow the call stack.
 */
export function assertStorableText(json: unknown): void {
  const pending: unknown[] = [json];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (UNSTORABLE_CHARACTER.test(value)) throw new ApiError('invalid', copy.UNSTORABLE_TEXT);
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) pending.push(key, inner);
    }
  }
}
