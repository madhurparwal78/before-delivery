// Request body declarations: one per route, which both rejects keys outside it and reads the accepted ones.
import type { Messages } from '../shared/copy.js';
import { invalid } from './errors.js';
import { PROVINCES } from '../shared/catalog.js';

type Issues = Record<string, string>;
interface Scope {
  m: Messages;
  issues: Issues;
}
type MessageOf = (m: Messages) => string;

/** A field check: returns the accepted value, or records an issue at `path` and returns undefined. */
type Check<T> = (value: unknown, path: string, scope: Scope) => T | undefined;
type Shape = Record<string, Check<unknown> & { optional?: boolean }>;
type Parsed<S extends Shape> = { [K in keyof S]: S[K] extends Check<infer T> ? T : never };

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;

function fail(scope: Scope, path: string, message: MessageOf): undefined {
  scope.issues[path] = message(scope.m);
  return undefined;
}

/** A trimmed text of `min` to `max` characters; single-line unless `multiline`. */
export function text(message: MessageOf, min = 1, max = 500, multiline = false): Check<string> {
  return (value, path, scope) => {
    if (typeof value !== 'string') return fail(scope, path, message);
    const trimmed = value.trim();
    const length = [...trimmed].length;
    if ((multiline ? CONTROL_EXCEPT_NEWLINES : CONTROL).test(value) || length < min || length > max) return fail(scope, path, message);
    return trimmed;
  };
}

/** A bare address: 3 to 254 characters, one `@`, a dotted domain, no space, comma, semicolon, bracket, quote or control. */
export function email(): Check<string> {
  return (value, path, scope) => {
    const message: MessageOf = (m) => m.fields.email;
    if (typeof value !== 'string') return fail(scope, path, message);
    const address = value.trim();
    const at = address.indexOf('@');
    const valid =
      address.length >= 3 &&
      address.length <= 254 &&
      at > 0 &&
      at === address.lastIndexOf('@') &&
      address.slice(at + 1).includes('.') &&
      !/[\s,;<>"'\u0000-\u001f\u007f]/.test(address) &&
      !address.endsWith('.') &&
      !address.slice(at + 1).startsWith('.');
    return valid ? address.toLowerCase() : fail(scope, path, message);
  };
}

export function oneOf<T extends string>(values: readonly T[], message: MessageOf): Check<T> {
  return (value, path, scope) => (values.includes(value as T) ? (value as T) : fail(scope, path, message));
}

export function integer(min: number, max: number, message: MessageOf): Check<number> {
  return (value, path, scope) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fail(scope, path, message);
}

export function boolean(message: MessageOf): Check<boolean> {
  return (value, path, scope) => (typeof value === 'boolean' ? value : fail(scope, path, message));
}

export function list<T>(item: Check<T>, message: MessageOf, min = 1, max = 48): Check<T[]> {
  return (value, path, scope) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) return fail(scope, path, message);
    const out: T[] = [];
    value.forEach((entry, index) => {
      const parsed = item(entry, `${path}.${index}`, scope);
      if (parsed !== undefined) out.push(parsed);
    });
    return out.length === value.length ? out : undefined;
  };
}

export function optional<T>(check: Check<T>): Check<T> & { optional: true } {
  return Object.assign((value: unknown, path: string, scope: Scope) => check(value, path, scope), { optional: true as const });
}

/** A closed object: every key outside `shape` is reported under its dotted path. */
export function object<S extends Shape>(shape: S, message: MessageOf = (m) => m.fields.cantSet): Check<Parsed<S>> {
  return (value, path, scope) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(scope, path || '', message);
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let complete = true;
    for (const key of Object.keys(record)) {
      if (!(key in shape)) {
        scope.issues[path ? `${path}.${key}` : key] = scope.m.fields.cantSet;
        complete = false;
      }
    }
    for (const [key, check] of Object.entries(shape)) {
      if (check.optional && record[key] === undefined) continue;
      const parsed = check(record[key], path ? `${path}.${key}` : key, scope);
      if (parsed === undefined) complete = false;
      else out[key] = parsed;
    }
    return complete ? (out as Parsed<S>) : undefined;
  };
}

/** Reads a body against its declaration, or throws 422 with every failing field. */
export function read<T>(declaration: Check<T>, body: unknown, m: Messages): T {
  const scope: Scope = { m, issues: {} };
  const parsed = declaration(body ?? {}, '', scope);
  if (parsed === undefined || Object.keys(scope.issues).length > 0) throw invalid(m, scope.issues);
  return parsed;
}

const POSTAL_CODE = /^([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]) ?(\d[ABCEGHJ-NPRSTV-Z]\d)$/i;

function postalCode(): Check<string> {
  return (value, path, scope) => {
    const match = typeof value === 'string' ? POSTAL_CODE.exec(value.trim()) : null;
    return match ? `${match[1]} ${match[2]}`.toUpperCase() : fail(scope, path, (m) => m.fields.postal_code);
  };
}

/** The closed shipping object shared by checkout and subscription start. */
export const shippingAddress = object({
  name: text((m) => m.fields.name, 1, 120),
  line1: text((m) => m.fields.line1, 1, 200),
  city: text((m) => m.fields.city, 1, 100),
  province: oneOf(
    PROVINCES.map((p) => p.code),
    (m) => m.fields.province,
  ),
  postal_code: postalCode(),
});
export type ShippingAddress = NonNullable<ReturnType<typeof shippingAddress>>;

/** Reads one declared field without reporting, for the checks the error precedence makes before validation. */
export function peek<T>(check: Check<T>, value: unknown, m: Messages): T | undefined {
  return check(value, '', { m, issues: {} });
}
