// Money in JSON: fields ending in `Cents` are integers on the wire and BigInt in the source on both sides.
// Reading takes each such integer from its source text, so it never passes through a binary float;
// writing puts a BigInt back as a plain JSON integer.

interface ReviverContext {
  source?: string;
}

type Reviver = (this: unknown, key: string, value: unknown, context: ReviverContext) => unknown;

const INTEGER = /^-?\d+$/;

const reviveCents: Reviver = (key, value, context) =>
  key.endsWith("Cents") && typeof value === "number" && context.source !== undefined && INTEGER.test(context.source)
    ? BigInt(context.source)
    : value;

/** Parses JSON text with every integer `…Cents` value as a BigInt. */
export function parseMoneyJson(text: string): unknown {
  return JSON.parse(text, reviveCents as Parameters<typeof JSON.parse>[1]);
}

/** Serialises JSON with every BigInt written as a plain integer. */
export function stringifyMoneyJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? JSON.rawJSON(v.toString()) : v));
}
