import { Fields, isRecord } from './errors.js';

/** Field readers that report into one Fields collector and return a typed value or undefined. */
export class Input {
  constructor(
    readonly body: Record<string, unknown>,
    readonly fields: Fields,
  ) {}

  static from(value: unknown, fields = new Fields()): Input {
    if (!isRecord(value)) {
      fields.add('body', 'must be a JSON object');
      return new Input({}, fields);
    }
    return new Input(value, fields);
  }

  has(name: string): boolean {
    return this.body[name] !== undefined;
  }

  text(name: string, min: number, max: number, { trim = false } = {}): string | undefined {
    const raw = this.body[name];
    if (typeof raw !== 'string') {
      this.fields.add(name, 'must be text');
      return undefined;
    }
    const value = trim ? raw.trim() : raw;
    if (value.length < min || value.length > max) {
      this.fields.add(name, min === max ? `must be ${min} characters` : `must be ${min} to ${max} characters`);
      return undefined;
    }
    return value;
  }

  int(name: string, min: number, max: number): number | undefined {
    const value = this.body[name];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.fields.add(name, 'must be a whole number');
      return undefined;
    }
    if (value < min || value > max) {
      this.fields.add(name, `must be between ${min} and ${max}`);
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(name: string, allowed: readonly T[]): T | undefined {
    const value = this.body[name];
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fields.add(name, `must be one of ${allowed.join(', ')}`);
      return undefined;
    }
    return value as T;
  }

  bool(name: string): boolean | undefined {
    const value = this.body[name];
    if (typeof value !== 'boolean') {
      this.fields.add(name, 'must be true or false');
      return undefined;
    }
    return value;
  }
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
