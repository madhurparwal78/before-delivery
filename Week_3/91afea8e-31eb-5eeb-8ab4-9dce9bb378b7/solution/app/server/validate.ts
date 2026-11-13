import { FIELD, validationFailed } from "./errors.js";

type Raw = Record<string, unknown>;

function codePoints(text: string): number {
  return [...text].length;
}

interface TextOptions {
  label: string;
  min?: number;
  max: number;
  optional?: boolean;
}

/** Reads one request body and collects every field error before answering 422. */
export class Body {
  private readonly children: Body[] = [];

  constructor(
    private readonly raw: Raw,
    private readonly allowed: readonly string[],
    private readonly errors: Record<string, string> = {},
  ) {}

  private take(name: string): unknown {
    return this.raw[name];
  }

  /** A nested object validated with the same error map; its unknown fields are reported by `done`. */
  child(raw: Raw, allowed: readonly string[]): Body {
    const child = new Body(raw, allowed, this.errors);
    this.children.push(child);
    return child;
  }

  fail(name: string, message: string): void {
    this.errors[name] ??= message;
  }

  text(name: string, options: TextOptions): string | undefined {
    const value = this.take(name);
    if (value === undefined) {
      if (!options.optional) this.fail(name, FIELD.nameLength(options.label, options.min ?? 1, options.max, 0));
      return undefined;
    }
    if (typeof value !== "string" || value.includes("\0")) {
      this.fail(name, FIELD.needsText);
      return undefined;
    }
    const length = codePoints(value);
    const min = options.min ?? 0;
    if (length < min || length > options.max) {
      this.fail(name, FIELD.nameLength(options.label, min, options.max, length));
      return undefined;
    }
    return value;
  }

  int(name: string, options: { min: number; max: number; message: string; tooHigh?: string; optional?: boolean }): number | undefined {
    const value = this.take(name);
    if (value === undefined) {
      if (!options.optional) this.fail(name, options.message);
      return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < options.min || value > options.max) {
      this.fail(name, typeof value === "number" && value > options.max && options.tooHigh ? options.tooHigh : options.message);
      return undefined;
    }
    return value;
  }

  bool(name: string, optional = false): boolean | undefined {
    const value = this.take(name);
    if (typeof value === "boolean") return value;
    if (value !== undefined || !optional) this.fail(name, FIELD.badChoice);
    return undefined;
  }

  choice<T extends string>(name: string, values: readonly T[], optional = false): T | undefined {
    const value = this.take(name);
    if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
    if (value !== undefined || !optional) this.fail(name, FIELD.badChoice);
    return undefined;
  }

  /** The raw value of a nested field the caller validates itself. */
  nested(name: string): unknown {
    return this.take(name);
  }

  /** Throws 422 listing every field error and every field the route does not accept. */
  done(): void {
    for (const body of [this, ...this.children]) {
      for (const key of Object.keys(body.raw)) {
        if (!body.allowed.includes(key)) this.errors[key] = FIELD.cantSet;
      }
    }
    if (Object.keys(this.errors).length > 0) throw validationFailed(this.errors);
  }
}

export function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A route that takes `{}` accepts no field at all. */
export function noFields(raw: Raw): void {
  new Body(raw, []).done();
}
