/** I-JSON (RFC 7493) parsing: duplicate members, lone surrogates and huge integers are malformed. */

import type { JsonValue } from "./canonical.js";

class IJsonError extends Error {}

const MAX_SAFE = 9_007_199_254_740_991;

export function parseIJson(text: string): JsonValue {
  const parser = new Parser(text);
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (!parser.atEnd()) {
    throw new IJsonError("trailing content");
  }
  return value;
}

class Parser {
  private at = 0;

  constructor(private readonly text: string) {}

  atEnd(): boolean {
    return this.at >= this.text.length;
  }

  skipWhitespace(): void {
    while (this.at < this.text.length && " \t\n\r".includes(this.text[this.at])) {
      this.at += 1;
    }
  }

  private expect(character: string): void {
    if (this.text[this.at] !== character) {
      throw new IJsonError(`expected ${character}`);
    }
    this.at += 1;
  }

  parseValue(): JsonValue {
    this.skipWhitespace();
    const character = this.text[this.at];
    if (character === undefined) {
      throw new IJsonError("unexpected end of input");
    }
    if (character === "{") {
      return this.parseObject();
    }
    if (character === "[") {
      return this.parseArray();
    }
    if (character === '"') {
      return this.parseString();
    }
    if (this.text.startsWith("true", this.at)) {
      this.at += 4;
      return true;
    }
    if (this.text.startsWith("false", this.at)) {
      this.at += 5;
      return false;
    }
    if (this.text.startsWith("null", this.at)) {
      this.at += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseObject(): JsonValue {
    this.expect("{");
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.at] === "}") {
      this.at += 1;
      return { ...result };
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.parseString();
      if (seen.has(key)) {
        throw new IJsonError("duplicate member name");
      }
      seen.add(key);
      this.skipWhitespace();
      this.expect(":");
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.text[this.at] === ",") {
        this.at += 1;
        continue;
      }
      this.expect("}");
      return { ...result };
    }
  }

  private parseArray(): JsonValue {
    this.expect("[");
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.at] === "]") {
      this.at += 1;
      return items;
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.at] === ",") {
        this.at += 1;
        continue;
      }
      this.expect("]");
      return items;
    }
  }

  private parseString(): string {
    this.expect('"');
    let out = "";
    let pendingHighSurrogate = false;
    for (;;) {
      const character = this.text[this.at];
      if (character === undefined) {
        throw new IJsonError("unterminated string");
      }
      if (character === '"') {
        this.at += 1;
        if (pendingHighSurrogate) {
          throw new IJsonError("unpaired surrogate escape");
        }
        return out;
      }
      if (character === "\\") {
        const escape = this.text[this.at + 1];
        this.at += 2;
        if (escape === "u") {
          const hex = this.text.slice(this.at, this.at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new IJsonError("bad unicode escape");
          }
          this.at += 4;
          const code = Number.parseInt(hex, 16);
          if (code >= 0xd800 && code <= 0xdbff) {
            if (pendingHighSurrogate) {
              throw new IJsonError("unpaired surrogate escape");
            }
            pendingHighSurrogate = true;
            out += String.fromCharCode(code);
            continue;
          }
          if (code >= 0xdc00 && code <= 0xdfff) {
            if (!pendingHighSurrogate) {
              throw new IJsonError("unpaired surrogate escape");
            }
            pendingHighSurrogate = false;
            out += String.fromCharCode(code);
            continue;
          }
          if (pendingHighSurrogate) {
            throw new IJsonError("unpaired surrogate escape");
          }
          out += String.fromCharCode(code);
          continue;
        }
        if (pendingHighSurrogate) {
          throw new IJsonError("unpaired surrogate escape");
        }
        const simple: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        const replacement = escape === undefined ? undefined : simple[escape];
        if (replacement === undefined) {
          throw new IJsonError("bad escape");
        }
        out += replacement;
        continue;
      }
      if (character < " ") {
        throw new IJsonError("control character in string");
      }
      if (pendingHighSurrogate) {
        throw new IJsonError("unpaired surrogate escape");
      }
      out += character;
      this.at += 1;
    }
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(this.text.slice(this.at));
    if (!match) {
      throw new IJsonError("bad number");
    }
    this.at += match[0].length;
    const value = Number(match[0]);
    const whole = match[1] === undefined && match[2] === undefined;
    if (whole && Math.abs(value) > MAX_SAFE) {
      throw new IJsonError("integer beyond the I-JSON range");
    }
    return value;
  }
}
