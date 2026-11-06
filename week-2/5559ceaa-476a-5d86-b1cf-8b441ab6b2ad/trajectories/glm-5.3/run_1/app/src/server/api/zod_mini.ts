import { ApiError } from "../errors.js";

type Primitive = string | number | boolean;

interface Schema<T> {
  parse(input: unknown): T;
}

class Str implements Schema<string> {
  constructor(
    private opts: { min?: number; max?: number; pattern?: RegExp; message?: string } = {},
  ) {}
  parse(input: unknown): string {
    if (typeof input !== "string") throw fail();
    if (this.opts.min !== undefined && input.length < this.opts.min) throw fail();
    if (this.opts.max !== undefined && input.length > this.opts.max) throw fail();
    if (this.opts.pattern && !this.opts.pattern.test(input)) throw fail();
    return input;
  }
}

class Num implements Schema<number> {
  constructor(private opts: { min?: number; max?: number; int?: boolean } = {}) {}
  parse(input: unknown): number {
    if (typeof input !== "number" || !Number.isFinite(input)) throw fail();
    if (this.opts.int && !Number.isInteger(input)) throw fail();
    if (this.opts.min !== undefined && input < this.opts.min) throw fail();
    if (this.opts.max !== undefined && input > this.opts.max) throw fail();
    return input;
  }
}

class Obj<S extends Record<string, Schema<unknown>>>
  implements Schema<{ [K in keyof S]: S[K] extends Schema<infer T> ? T : never }>
{
  fields: Record<string, string> = {};
  constructor(private shape: S) {}
  parse(input: unknown) {
    if (typeof input !== "object" || input === null) throw fail();
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this.shape)) {
      const schema = this.shape[key] as Schema<unknown> | undefined;
      if (!schema) continue;
      const v = (input as Record<string, unknown>)[key];
      if (v === undefined) {
        if (schema instanceof Optional) continue;
        this.fields[key] = "is required";
        throw validation(this.fields);
      }
      try {
        out[key] = schema.parse(v);
      } catch (e) {
        if (e instanceof ApiError && e.code === "validation") {
          this.fields[key] = typeof e.extra.message === "string" ? e.extra.message : "is invalid";
          throw validation(this.fields);
        }
        throw e;
      }
    }
    return out as { [K in keyof S]: S[K] extends Schema<infer T> ? T : never };
  }
}

class Optional<T> implements Schema<T | undefined> {
  constructor(private inner: Schema<T>) {}
  parse(input: unknown): T | undefined {
    if (input === undefined) return undefined;
    return this.inner.parse(input);
  }
}

class Lit<T extends Primitive> implements Schema<T> {
  constructor(private value: T) {}
  parse(input: unknown): T {
    if (input !== this.value) throw fail();
    return this.value;
  }
}

function fail(): ApiError {
  return new ApiError("validation", "Invalid input.", { message: "is invalid" });
}

function validation(fields: Record<string, string>): ApiError {
  return new ApiError("validation", "Invalid input.", { fields });
}

export const z = {
  string: (opts: { min?: number; max?: number; pattern?: RegExp } = {}) => new Str(opts),
  number: (opts: { min?: number; max?: number; int?: boolean } = {}) => new Num(opts),
  object: <S extends Record<string, Schema<unknown>>>(shape: S) => new Obj(shape),
  literal: <T extends Primitive>(v: T) => new Lit(v),
  optional: <T>(s: Schema<T>) => new Optional(s),
};
