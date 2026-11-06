/** Field validation. Every bad field in a request is reported in one 422. */

import type { JsonObject, JsonValue } from './body.js';
import * as errors from './errors.js';

export class Validator {
  private readonly messages: Record<string, string> = {};

  constructor(private readonly body: JsonObject = {}) {}

  fail(field: string, message: string): void {
    if (!(field in this.messages)) this.messages[field] = message;
  }

  get failed(): boolean {
    return Object.keys(this.messages).length > 0;
  }

  hasFailed(field: string): boolean {
    return field in this.messages;
  }

  private raw(field: string): JsonValue | undefined {
    return this.body[field];
  }

  /** A required string with a length range. */
  text(field: string, min: number, max: number): string {
    const value = this.raw(field);
    if (typeof value !== 'string' || value.trim().length === 0) {
      this.fail(field, `Enter ${field.replace(/_/g, ' ')}.`);
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) {
      this.fail(field, `Use between ${min} and ${max} characters.`);
      return trimmed;
    }
    return trimmed;
  }

  /** A required string kept exactly as sent, for passwords. */
  secret(field: string, min: number, max: number): string {
    const value = this.raw(field);
    if (typeof value !== 'string' || value.length < min || value.length > max) {
      this.fail(field, `Use between ${min} and ${max} characters.`);
      return typeof value === 'string' ? value : '';
    }
    return value;
  }

  email(field: string): string {
    const value = this.raw(field);
    if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      this.fail(field, 'Enter an email address.');
      return typeof value === 'string' ? value.trim().toLowerCase() : '';
    }
    return value.trim().toLowerCase();
  }

  integer(field: string, min: number, max: number): number {
    const value = this.raw(field);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.fail(field, `Enter a whole number from ${min} to ${max}.`);
      return 0;
    }
    return value;
  }

  optionalInteger(field: string, min: number, max: number, fallback: number): number {
    if (this.raw(field) === undefined || this.raw(field) === null) return fallback;
    return this.integer(field, min, max);
  }

  oneOf<T extends string>(field: string, allowed: readonly T[]): T {
    const value = this.raw(field);
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(field, `Choose one of: ${allowed.join(', ')}.`);
      return allowed[0];
    }
    return value as T;
  }

  /** A money string with two decimals inside a range. */
  money(field: string, min: string, max: string): string {
    const value = this.raw(field);
    if (typeof value !== 'string' || !/^\d{1,6}(\.\d{1,2})?$/.test(value)) {
      this.fail(field, 'Enter an amount such as 48.00.');
      return '0.00';
    }
    const amount = Number(value);
    if (amount < Number(min) || amount > Number(max)) {
      this.fail(field, `Enter an amount from ${min} to ${max}.`);
    }
    return value;
  }

  value(field: string): JsonValue | undefined {
    return this.raw(field);
  }

  done(): void {
    if (this.failed) throw errors.validation({ ...this.messages });
  }

  /** Raises the accumulated 422 immediately, used when one field must stop the request. */
  static one(field: string, message: string): never {
    throw errors.validation({ [field]: message });
  }
}
