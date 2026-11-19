// The allowed request keys, the unstorable-text check and the field rules.
import { fail, type JsonBody } from "./http.ts";

/** U+0000 or an unpaired UTF-16 surrogate cannot be stored. */
export function unstorable(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

const UNSTORABLE = "This text contains a character that cannot be stored.";

/**
 * Validation step for a JSON body: unknown keys, then every string field is checked for
 * unstorable characters, then each field rule. Throws one 422 naming every offending key.
 */
export class Fields {
  private readonly errors: Record<string, string> = {};

  constructor(
    private readonly body: JsonBody,
    allowed: readonly string[],
  ) {
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) this.errors[key] = "This field is not accepted here.";
    }
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && unstorable(value) && !this.errors[key]) this.errors[key] = UNSTORABLE;
    }
  }

  private open(key: string): boolean {
    return this.errors[key] === undefined;
  }

  isClean(key: string): boolean {
    return this.open(key);
  }

  reject(key: string, message: string): void {
    if (this.open(key)) this.errors[key] = message;
  }

  /** A required string that must satisfy `rule`. */
  string(key: string, message: string, rule: (value: string) => boolean = () => true): string {
    const value = this.body[key];
    if (typeof value !== "string" || (this.open(key) && !rule(value))) this.reject(key, message);
    return typeof value === "string" ? value : "";
  }


  integer(key: string, message: string, rule: (value: number) => boolean = () => true): number {
    const value = this.body[key];
    if (typeof value !== "number" || !Number.isInteger(value) || !rule(value)) {
      this.reject(key, message);
      return 0;
    }
    return value;
  }

  optionalInteger(key: string, message: string, rule: (value: number) => boolean): number | undefined {
    if (this.body[key] === undefined) return undefined;
    return this.integer(key, message, rule);
  }

  oneOf<T extends string>(key: string, choices: readonly T[], message: string): T {
    const value = this.body[key];
    if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) {
      this.reject(key, message);
      return choices[0] as T;
    }
    return value as T;
  }

  check(): void {
    if (Object.keys(this.errors).length > 0) throw fail.invalid({ ...this.errors });
  }
}

/** Only these keys may appear; anything else is refused naming the key. */
export function onlyKeys(body: JsonBody, allowed: readonly string[]): void {
  new Fields(body, allowed).check();
}

const SEGMENT = /^[A-Za-z0-9_\-][A-Za-z0-9._\-]{0,99}$/;

export function validPath(path: string): boolean {
  if (path.length < 1 || path.length > 200) return false;
  return path.split("/").every((segment) => SEGMENT.test(segment));
}

export const TEXT_EXTENSIONS = [".tex", ".bib", ".sty", ".cls", ".bst", ".txt"] as const;

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export const TEXT_LIMIT_BYTES = 1_000_000;

export function textFits(content: string): boolean {
  return Buffer.byteLength(content, "utf8") <= TEXT_LIMIT_BYTES;
}

export const PATH_MESSAGE = "Use letters, digits, dots, hyphens and underscores, separated by slashes.";

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function validTitle(title: string): boolean {
  return title.length >= 1 && title.length <= 120 && !CONTROL.test(title);
}

export function validDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 80;
}

export function normalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
