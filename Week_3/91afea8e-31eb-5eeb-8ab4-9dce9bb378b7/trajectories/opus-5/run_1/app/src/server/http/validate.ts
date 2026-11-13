/** Body reading with the published field messages. */

import { FIELD } from '../../shared/messages.js';
import { countCodePoints } from '../domain/identity.js';
import { validationFailed } from './errors.js';

export class Validator {
  private readonly errors: Record<string, string> = {};
  private readonly body: Record<string, unknown>;

  constructor(body: Record<string, unknown>, allowed: readonly string[]) {
    this.body = body;
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) this.errors[key] = FIELD.unsettable;
    }
  }

  fail(field: string, message: string): void {
    this.errors[field] = message;
  }

  has(key: string): boolean {
    return this.body[key] !== undefined;
  }

  raw(key: string): unknown {
    return this.body[key];
  }

  text(
    key: string,
    options: { label: string; min: number; max: number; required?: boolean },
  ): string {
    const value = this.body[key];
    if (value === undefined || value === null) {
      if (options.required === false || options.min === 0) return '';
      this.fail(key, FIELD.tooShort(options.label, Math.max(options.min, 1)));
      return '';
    }
    if (typeof value !== 'string') {
      this.fail(key, FIELD.tooShort(options.label, Math.max(options.min, 1)));
      return '';
    }
    const length = countCodePoints(value);
    if (length < options.min) {
      this.fail(key, FIELD.tooShort(options.label, options.min));
      return value;
    }
    if (length > options.max) {
      this.fail(key, FIELD.tooLong(options.label, options.max));
      return value;
    }
    return value;
  }

  integer(key: string, options: { min: number; max: number; message?: string }): number {
    const value = this.body[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.fail(key, options.message ?? FIELD.tooShort(key, options.min));
      return options.min;
    }
    if (value < options.min || value > options.max) {
      this.fail(key, options.message ?? FIELD.tooShort(key, options.min));
      return value;
    }
    return value;
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.body[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') {
      this.fail(key, FIELD.unsettable);
      return fallback;
    }
    return value;
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) throw validationFailed(this.errors);
  }

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }
}
