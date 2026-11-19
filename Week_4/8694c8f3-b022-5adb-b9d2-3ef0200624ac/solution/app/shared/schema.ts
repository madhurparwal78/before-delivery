export type Fields = Record<string, string>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; fields: Fields };

export interface Schema<T> {
  parse(input: unknown, path: string): Parsed<T>;
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (path: string, message: string): Parsed<never> => ({ ok: false, fields: { [path]: message } });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(options: { min?: number; max?: number; trim?: boolean; valid?: (value: string) => boolean; message: string }): Schema<string> {
  return {
    parse(input, path) {
      if (typeof input !== "string") return fail(path, options.message);
      const value = options.trim ? input.trim() : input;
      const length = [...value].length;
      if (length < (options.min ?? 0) || length > (options.max ?? Infinity) || options.valid?.(value) === false) return fail(path, options.message);
      return ok(value);
    },
  };
}

export function num(options: { min?: number; max?: number; integer?: boolean; message: string }): Schema<number> {
  return {
    parse(input, path) {
      if (typeof input !== "number" || !Number.isFinite(input)) return fail(path, options.message);
      if (options.integer && !Number.isInteger(input)) return fail(path, options.message);
      if (input < (options.min ?? -Infinity) || input > (options.max ?? Infinity)) return fail(path, options.message);
      return ok(input);
    },
  };
}

export function oneOf<const T extends string>(values: readonly T[], message: string): Schema<T> {
  return {
    parse(input, path) {
      const found = values.find((candidate) => candidate === input);
      return found === undefined ? fail(path, message) : ok(found);
    },
  };
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return { parse: (input, path) => (input === null ? ok(null) : inner.parse(input, path)) };
}

export function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return { parse: (input, path) => (input === undefined ? ok(undefined) : inner.parse(input, path)) };
}

type Shape = Record<string, Schema<unknown>>;
type Infer<S extends Shape> = { [K in keyof S]: S[K] extends Schema<infer T> ? T : never };

export function object<S extends Shape>(shape: S, message = "Expected an object"): Schema<Infer<S>> {
  return {
    parse(input, path) {
      if (!isRecord(input)) return fail(path || "body", message);
      const fields: Fields = {};
      const out: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) {
        const parsed = schema.parse(input[key], key);
        if (parsed.ok) out[key] = parsed.value;
        else Object.assign(fields, parsed.fields);
      }
      if (Object.keys(fields).length > 0) return { ok: false, fields };
      return ok(out as Infer<S>);
    },
  };
}

export function anyRecord(message: string): Schema<Record<string, unknown>> {
  return { parse: (input, path) => (isRecord(input) ? ok(input) : fail(path, message)) };
}

export function parseBody<T>(schema: Schema<T>, input: unknown): Parsed<T> {
  return schema.parse(input, "");
}
