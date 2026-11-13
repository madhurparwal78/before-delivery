/**
 * Strict request bodies. A body must be a JSON object; a key the endpoint
 * does not define is refused; string fields refuse control characters before
 * the server applies Unicode NFC normalisation; and when one field breaks
 * several checks it carries only the first message.
 */

import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { isAsset, type Asset } from '../domain/assets.ts';
import { parseApiAmount, parseApiPrice } from '../domain/apiformat.ts';
import { validationFailed } from './problem.ts';

/** C0 and C1 control characters, plus the two Unicode line separators. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export class Validator {
  private readonly raw: Readonly<Record<string, unknown>>;
  private readonly problems = new Map<string, string>();

  constructor(body: Readonly<Record<string, unknown>>, allowedKeys: readonly string[]) {
    this.raw = body;
    for (const key of Object.keys(body)) {
      if (!allowedKeys.includes(key)) {
        this.problems.set(key, API_FIELD_MESSAGE.unknownField);
      }
    }
    // The control-character check runs before any normalisation.
    for (const key of allowedKeys) {
      const value = body[key];
      if (typeof value === 'string' && CONTROL_CHARACTERS.test(value)) {
        this.problems.set(key, API_FIELD_MESSAGE.controlCharacters);
      }
    }
  }

  /** Records a message unless the field already carries one. */
  fail(field: string, message: string): void {
    if (!this.problems.has(field)) this.problems.set(field, message);
  }

  private has(field: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.raw, field);
  }

  private settled(field: string): boolean {
    return this.problems.has(field);
  }

  /** A string field, NFC normalised once its characters have been checked. */
  text(field: string, message: string): string | null {
    const value = this.raw[field];
    if (this.settled(field)) return null;
    if (typeof value !== 'string') {
      this.fail(field, message);
      return null;
    }
    return value.normalize('NFC');
  }

  /** An amount: a digit string of minor units above zero, no leading zeros. */
  amount(field: string): bigint | null {
    const value = this.raw[field];
    if (this.settled(field)) return null;
    if (typeof value !== 'string') {
      this.fail(field, API_FIELD_MESSAGE.amountUnits);
      return null;
    }
    const parsed = parseApiAmount(value);
    if (parsed === null) {
      this.fail(field, API_FIELD_MESSAGE.amountUnits);
      return null;
    }
    return parsed;
  }

  /** A repayment amount, which may also be the string `"all"`. */
  amountOrAll(field: string): bigint | 'all' | null {
    const value = this.raw[field];
    if (this.settled(field)) return null;
    if (typeof value !== 'string') {
      this.fail(field, API_FIELD_MESSAGE.amountUnits);
      return null;
    }
    if (value === 'all') return 'all';
    const parsed = parseApiAmount(value);
    if (parsed === null) {
      this.fail(field, API_FIELD_MESSAGE.amountUnits);
      return null;
    }
    return parsed;
  }

  asset(field: string): Asset | null {
    const value = this.raw[field];
    if (this.settled(field)) return null;
    if (!isAsset(value)) {
      this.fail(field, API_FIELD_MESSAGE.unlistedAsset);
      return null;
    }
    return value;
  }

  /** A price request string: digits with an optional point and 1 to 8 decimals. */
  price(field: string): bigint | null {
    const value = this.raw[field];
    if (this.settled(field)) return null;
    if (typeof value !== 'string') {
      this.fail(field, API_FIELD_MESSAGE.priceShape);
      return null;
    }
    const parsed = parseApiPrice(value);
    if (parsed === null) {
      this.fail(field, API_FIELD_MESSAGE.priceShape);
      return null;
    }
    return parsed;
  }

  /** A whole JSON number. A numeric string is not a number. */
  wholeNumber(field: string, message: string): number | null {
    const value = this.raw[field];
    if (this.settled(field)) return null;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.fail(field, message);
      return null;
    }
    return value;
  }

  /** An optional boolean. Absent is allowed; a wrong type is not. */
  optionalBoolean(field: string, message: string): boolean | undefined {
    if (!this.has(field)) return undefined;
    const value = this.raw[field];
    if (this.settled(field)) return undefined;
    if (typeof value !== 'boolean') {
      this.fail(field, message);
      return undefined;
    }
    return value;
  }

  /** An optional whole JSON number in basis points. */
  optionalBps(field: string, message: string): number | undefined {
    if (!this.has(field)) return undefined;
    const value = this.raw[field];
    if (this.settled(field)) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.fail(field, message);
      return undefined;
    }
    return value;
  }

  present(field: string): boolean {
    return this.has(field);
  }

  get failed(): boolean {
    return this.problems.size > 0;
  }

  /** Throws the 422 when any field carries a message. */
  finish(): void {
    if (this.problems.size === 0) return;
    throw validationFailed(Object.fromEntries(this.problems));
  }
}

/**
 * Answers the 422 when any field carries a message, and otherwise narrows the
 * fields the endpoint collected to their non-null types. This is the one place
 * that bridges "every field was checked" to "every field has a value".
 */
export function finishWith<T extends Record<string, unknown>>(
  validator: Validator,
  values: T,
): { [K in keyof T]: NonNullable<T[K]> } {
  validator.finish();
  for (const [field, value] of Object.entries(values)) {
    if (value === null || value === undefined) {
      throw new Error(`Field ${field} was not read and carries no message`);
    }
  }
  return values as { [K in keyof T]: NonNullable<T[K]> };
}
