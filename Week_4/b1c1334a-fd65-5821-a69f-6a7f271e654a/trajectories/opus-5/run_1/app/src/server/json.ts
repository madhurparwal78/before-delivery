/**
 * JSON numbers are kept as their exact source characters, so a Decimal never
 * passes through a binary floating-point number.
 */
export class RawNumber {
  constructor(readonly text: string) {}
}

type Reviver = (
  this: unknown,
  key: string,
  value: unknown,
  context?: { source?: string },
) => unknown;

export function parseJson(text: string): unknown {
  const reviver: Reviver = (_key, value, context) => {
    if (typeof value === 'number' && context?.source !== undefined) {
      return new RawNumber(context.source);
    }
    return value;
  };
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
}

export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asInteger(value: unknown): number | null {
  if (!(value instanceof RawNumber)) return null;
  if (!/^-?[0-9]+$/.test(value.text)) return null;
  const parsed = Number(value.text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}
