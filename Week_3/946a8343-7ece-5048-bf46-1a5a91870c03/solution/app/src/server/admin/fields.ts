// Reads one JSON object field by field: every accessor returns the declared type or refuses with a 422 naming the field path.
import { validationOne } from "../errors.ts";
import { isOneOf, isRecord } from "../json.ts";

export type Parse<T> = (value: unknown, at: string) => T;

const refuse = (at: string, message: string): never => {
  throw validationOne(at, message);
};

export class Fields {
  private readonly body: Record<string, unknown>;
  private readonly at: string;

  constructor(value: unknown, at: string) {
    this.body = isRecord(value) ? value : refuse(at, "Must be an object.");
    this.at = at;
  }

  private path(key: string): string {
    return this.at === "" ? key : `${this.at}.${key}`;
  }

  private present(key: string): unknown {
    return this.body[key] === null ? undefined : this.body[key];
  }

  maybeText(key: string): string | undefined {
    const found = this.present(key);
    return found === undefined || typeof found === "string" ? found : refuse(this.path(key), `${key} must be text.`);
  }

  /** Non-empty text. */
  name(key: string): string {
    const found = this.maybeText(key);
    return found !== undefined && found !== "" ? found : refuse(this.path(key), `${key} is required.`);
  }

  /** Text, empty when absent. */
  text(key: string): string {
    return this.maybeText(key) ?? "";
  }

  nullableText(key: string): string | null {
    return this.maybeText(key) ?? null;
  }

  nullableInt(key: string): number | null {
    const found = this.present(key);
    if (found === undefined) return null;
    return typeof found === "number" && Number.isInteger(found) ? found : refuse(this.path(key), `${key} must be a whole number.`);
  }

  /** Whole number from 0. */
  count(key: string): number {
    const found = this.nullableInt(key);
    return found !== null && found >= 0 ? found : refuse(this.path(key), `${key} must be a whole number from 0.`);
  }

  maybeFlag(key: string): boolean | undefined {
    const found = this.present(key);
    return found === undefined || typeof found === "boolean" ? found : refuse(this.path(key), `${key} must be true or false.`);
  }

  /** True or false, false when absent. */
  flag(key: string): boolean {
    return this.maybeFlag(key) ?? false;
  }

  maybeChoice<T extends string>(key: string, allowed: readonly T[]): T | undefined {
    const found = this.present(key);
    if (found === undefined) return undefined;
    return isOneOf(allowed, found) ? found : refuse(this.path(key), `${key} must be ${allowed.join(", ")}.`);
  }

  choice<T extends string>(key: string, allowed: readonly T[]): T {
    return this.maybeChoice(key, allowed) ?? refuse(this.path(key), `${key} must be ${allowed.join(", ")}.`);
  }

  maybeEach<T>(key: string, parse: Parse<T>): T[] | undefined {
    const found = this.present(key);
    if (found === undefined) return undefined;
    if (!Array.isArray(found)) return refuse(this.path(key), `${key} must be a list.`);
    return found.map((item: unknown, index) => parse(item, `${this.path(key)}.${index}`));
  }

  /** List of parsed items, empty when absent. */
  each<T>(key: string, parse: Parse<T>): T[] {
    return this.maybeEach(key, parse) ?? [];
  }

  /** List of text, empty when absent. */
  names(key: string): string[] {
    return this.each(key, (item, at) => (typeof item === "string" ? item : refuse(at, "Must be text.")));
  }

  /** List of allowed literals, empty when absent. */
  choices<T extends string>(key: string, allowed: readonly T[]): T[] {
    return this.each(key, (item, at) => (isOneOf(allowed, item) ? item : refuse(at, `Must be ${allowed.join(", ")}.`)));
  }

  maybeOne<T>(key: string, parse: Parse<T>): T | undefined {
    const found = this.present(key);
    return found === undefined ? undefined : parse(found, this.path(key));
  }

  /** Text values by name, undefined when absent. */
  textMap(key: string): Record<string, string> | undefined {
    return this.maybeOne(key, (found, at) => {
      const entries = Object.entries(new Fields(found, at).body);
      return Object.fromEntries(entries.map(([name, item]) => [name, typeof item === "string" ? item : refuse(`${at}.${name}`, "Must be text.")]));
    });
  }
}
