/** Field validation that reports every refusal in the one validation body. */

import { countCharacters, hasLineBreak } from '../../shared/chars.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { formatCentsPlain } from '../../shared/format.js';
import { ValidationError } from '../http/errors.js';

export interface TextRule {
  label: string;
  min?: number;
  max: number;
  oneLine?: boolean;
}

export class Fields {
  private readonly errors: Record<string, string> = {};

  add(path: string, copy: string): void {
    if (!(path in this.errors)) this.errors[path] = copy;
  }

  get failed(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  /** Throws the one validation error when any field was refused. */
  finish(): void {
    if (this.failed) throw new ValidationError(this.errors);
  }

  text(path: string, value: unknown, rule: TextRule): string {
    const min = rule.min ?? 1;
    if (typeof value !== 'string') {
      if (min > 0) this.add(path, fieldErrorCopy.required(rule.label));
      return '';
    }
    if (value.length === 0) {
      if (min > 0) this.add(path, fieldErrorCopy.required(rule.label));
      return value;
    }
    if (rule.oneLine && hasLineBreak(value)) {
      this.add(path, fieldErrorCopy.oneLine(rule.label));
      return value;
    }
    const length = countCharacters(value);
    if (length < min) this.add(path, fieldErrorCopy.required(rule.label));
    else if (length > rule.max) this.add(path, fieldErrorCopy.tooLong(rule.label, rule.max));
    return value;
  }

  email(path: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      this.add(path, fieldErrorCopy.required('Email'));
      return '';
    }
    if (!isSingleEmail(value)) {
      this.add(path, fieldErrorCopy.badEmail());
    }
    return value;
  }

  integer(
    path: string,
    value: unknown,
    label: string,
    min: number,
    max: number,
  ): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.add(path, fieldErrorCopy.required(label));
      return min;
    }
    if (value < min || value > max) {
      this.add(path, fieldErrorCopy.outOfRange(label, String(min), String(max)));
    }
    return value;
  }

  /** A whole-cent amount, reported with its range in decimal currency units. */
  cents(path: string, value: unknown, label: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.add(path, fieldErrorCopy.badAmount());
      return min;
    }
    if (value < min || value > max) {
      this.add(
        path,
        fieldErrorCopy.outOfRange(label, formatCentsPlain(min), formatCentsPlain(max)),
      );
    }
    return value;
  }

  enumeration<T extends string>(
    path: string,
    value: unknown,
    label: string,
    allowed: readonly T[],
  ): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.add(path, fieldErrorCopy.required(label));
      return allowed[0] as T;
    }
    return value as T;
  }
}

const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function isSingleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** A decimal percentage string with at most two places, within range. */
export function parsePercent(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const numeric = Number(text);
  if (numeric < 0 || numeric > max) return null;
  return text;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
