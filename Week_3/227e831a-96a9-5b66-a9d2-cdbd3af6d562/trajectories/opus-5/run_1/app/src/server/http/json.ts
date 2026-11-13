import { validationFailed } from './errors.js';

/**
 * A JSON number kept as the decimal text the request wrote, so gram
 * conversion can be exact rather than binary floating point.
 */
export class JsonNumber {
  constructor(readonly text: string) {}
  get value(): number {
    return Number(this.text);
  }
}

type Reviver = (
  this: unknown,
  key: string,
  value: unknown,
  context?: { source?: string },
) => unknown;

export function parseJson(text: string): unknown {
  const reviver: Reviver = (_key, value, context) => {
    if (typeof value === 'number' && context !== undefined && typeof context.source === 'string') {
      return new JsonNumber(context.source);
    }
    return value;
  };
  return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every write route declares its published fields here: the same declaration
 * drives the unknown-field refusal.
 */
export function declaredBody(
  body: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  const object = isPlainObject(body) ? body : {};
  const fields: Record<string, string> = {};
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fields[key] = "This field can't be set.";
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return object;
}

export function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function numberTextOf(value: unknown): string | null {
  return value instanceof JsonNumber ? value.text : null;
}

export function integerOf(value: unknown): number | null {
  if (!(value instanceof JsonNumber)) return null;
  if (!/^-?\d+$/.test(value.text)) return null;
  const parsed = Number(value.text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function present(value: unknown): boolean {
  return value !== undefined;
}
