// Reading request bodies: every field is checked, and all the problems are reported together.

import { fail } from './errors';

export class Fields {
  readonly problems: Record<string, string> = {};

  constructor(private readonly json: Record<string, unknown>) {}

  /** A trimmed string of 1 to `max` characters. */
  text(name: string, max: number, message = `Enter ${name} of 1 to ${max} characters.`): string {
    const value = this.json[name];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed === '' || trimmed.length > max) {
      this.problems[name] = message;
      return '';
    }
    return trimmed;
  }

  /** A string kept as sent (page sources keep their whitespace). */
  raw(name: string): string {
    const value = this.json[name];
    if (typeof value !== 'string') {
      this.problems[name] = `${name} must be text.`;
      return '';
    }
    return value;
  }

  integer(name: string, min = 0): number {
    const value = this.json[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      this.problems[name] = `${name} must be a whole number of at least ${min}.`;
      return min;
    }
    return value;
  }

  oneOf<T extends string>(name: string, allowed: readonly [T, ...T[]]): T {
    const chosen = allowed.find((candidate) => candidate === this.json[name]);
    if (chosen === undefined) {
      this.problems[name] = `${name} must be one of ${allowed.join(', ')}.`;
      return allowed[0];
    }
    return chosen;
  }

  /** Throw the validation error when any field was wrong. */
  check(): void {
    if (Object.keys(this.problems).length > 0) {
      throw fail.validation(this.problems);
    }
  }
}
