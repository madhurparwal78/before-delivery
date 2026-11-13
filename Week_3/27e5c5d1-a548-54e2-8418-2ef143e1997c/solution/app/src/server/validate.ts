import { validation } from './errors.ts';

/** One field of a request: turns an unknown value into a typed one, or a field message. */
interface Field<T> {
  parse(value: unknown): { ok: true; value: T } | { ok: false; message: string };
}

type Shape = Record<string, Field<unknown>>;
type Value<F> = F extends Field<infer T> ? T : never;
/** The values of a parsed request: required keys are always present, the others may be missing. */
type Values<S extends Shape, R extends keyof S> = { [K in R]: Value<S[K]> } & { [K in Exclude<keyof S, R>]?: Value<S[K]> };

/**
 * The published request keys of one endpoint. Required keys are listed in `required`, every other key in
 * the shape is optional, and any key outside the shape is refused by name (DP-50).
 */
export class Input<S extends Shape, R extends keyof S & string = never> {
  private readonly values: Partial<Record<keyof S, unknown>> = {};
  private readonly errors: Record<string, string> = {};

  constructor(raw: unknown, shape: S, required: readonly R[], options: { atLeastOne?: boolean } = {}) {
    if (raw === INVALID_JSON) {
      this.errors['body'] = 'The request body must be valid JSON.';
      return;
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      this.errors['body'] = 'The request body must be a JSON object.';
      return;
    }
    const record = raw as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(key in shape)) this.errors[key] = 'This key is not accepted here.';
    }
    for (const key of Object.keys(shape)) {
      const present = Object.hasOwn(record, key) && record[key] !== undefined;
      if (!present) {
        if ((required as readonly string[]).includes(key)) this.errors[key] = 'This is required.';
        continue;
      }
      const parsed = (shape[key] as Field<unknown>).parse(record[key]);
      if (parsed.ok) this.values[key as keyof S] = parsed.value;
      else this.errors[key] = parsed.message;
    }
    if (options.atLeastOne && Object.keys(this.errors).length === 0) {
      const optional = Object.keys(this.values).filter((key) => !(required as readonly string[]).includes(key));
      if (optional.length === 0) this.errors['body'] = 'Send at least one field to change.';
    }
  }

  /** Throws the 422 once every earlier step of the error precedence has passed. */
  check(extra: Record<string, string> = {}): Values<S, R> {
    const fields = { ...this.errors, ...extra };
    if (Object.keys(fields).length > 0) throw validation(fields);
    return this.values as Values<S, R>;
  }

  /** A value that an earlier precedence step needs; undefined when absent or malformed. */
  peek<K extends keyof S & string>(key: K): Value<S[K]> | undefined {
    return this.values[key] as Value<S[K]> | undefined;
  }
}

export const INVALID_JSON = Symbol('invalid json');

export const codePoints = (text: string): number => [...text].length;

export function text(options: { min?: number; max: number; trim?: boolean; empty: string; long: string }): Field<string> {
  return {
    parse(value) {
      if (typeof value !== 'string') return { ok: false, message: options.empty };
      const body = options.trim === false ? value : value.trim();
      const length = codePoints(body);
      if (length < (options.min ?? 1)) return { ok: false, message: options.empty };
      if (length > options.max) return { ok: false, message: options.long };
      return { ok: true, value: body };
    },
  };
}

export function oneOf<T extends string>(choices: readonly T[], message: string): Field<T> {
  return {
    parse: (value) =>
      typeof value === 'string' && (choices as readonly string[]).includes(value)
        ? { ok: true, value: value as T }
        : { ok: false, message },
  };
}

export function integer(message: string): Field<number> {
  return {
    parse: (value) =>
      typeof value === 'number' && Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, message },
  };
}

export function boolean(message: string): Field<boolean> {
  return { parse: (value) => (typeof value === 'boolean' ? { ok: true, value } : { ok: false, message }) };
}

export function nullable<T>(inner: Field<T>): Field<T | null> {
  return { parse: (value) => (value === null ? { ok: true, value: null } : inner.parse(value)) };
}

export function stringList(message: string, max: number): Field<string[]> {
  return {
    parse: (value) =>
      Array.isArray(value) && value.length <= max && value.every((item) => typeof item === 'string')
        ? { ok: true, value: value as string[] }
        : { ok: false, message },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id the server could have issued; anything else answers the plain not-found. */
export const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export function plainDate(message: string): Field<string> {
  return {
    parse(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, message };
      const parsed = new Date(`${value}T00:00:00Z`);
      return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
        ? { ok: false, message }
        : { ok: true, value };
    },
  };
}

export function timeZoneName(message: string): Field<string> {
  return {
    parse(value) {
      if (typeof value !== 'string' || value.length > 100) return { ok: false, message };
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return { ok: true, value };
      } catch {
        return { ok: false, message };
      }
    },
  };
}
