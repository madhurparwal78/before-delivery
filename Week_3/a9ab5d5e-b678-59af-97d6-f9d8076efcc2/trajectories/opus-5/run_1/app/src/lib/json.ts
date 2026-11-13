export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface ParsedBody {
  value: Json;
  /** Field path to the literal text of every number, so `1e3` is told from `1000`. */
  numberLiterals: Map<string, string>;
}

export class JsonSyntaxError extends Error {}

/** JSON parse that rejects duplicate object keys and keeps built-in property names as plain data. */
export function parseJsonStrict(text: string): ParsedBody {
  const reader = new Reader(text);
  reader.skipWhitespace();
  const value = reader.readValue('');
  reader.skipWhitespace();
  if (!reader.atEnd) throw new JsonSyntaxError('trailing content');
  return { value, numberLiterals: reader.numberLiterals };
}

const integerLiteral = /^(0|-?[1-9][0-9]*)$/;

export function isPlainIntegerLiteral(literal: string | undefined): boolean {
  return literal !== undefined && integerLiteral.test(literal);
}

class Reader {
  private index = 0;
  readonly numberLiterals = new Map<string, string>();

  constructor(private readonly text: string) {}

  get atEnd(): boolean {
    return this.index >= this.text.length;
  }

  skipWhitespace(): void {
    while (this.index < this.text.length) {
      const ch = this.text[this.index] as string;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') this.index += 1;
      else break;
    }
  }

  private expect(ch: string): void {
    if (this.text[this.index] !== ch) throw new JsonSyntaxError(`expected ${ch}`);
    this.index += 1;
  }

  readValue(path: string): Json {
    const ch = this.text[this.index];
    if (ch === undefined) throw new JsonSyntaxError('unexpected end');
    if (ch === '{') return this.readObject(path);
    if (ch === '[') return this.readArray(path);
    if (ch === '"') return this.readString();
    if (ch === 't') {
      this.readLiteral('true');
      return true;
    }
    if (ch === 'f') {
      this.readLiteral('false');
      return false;
    }
    if (ch === 'n') {
      this.readLiteral('null');
      return null;
    }
    return this.readNumber(path);
  }

  private readLiteral(literal: string): void {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      throw new JsonSyntaxError(`expected ${literal}`);
    }
    this.index += literal.length;
  }

  private readObject(path: string): Json {
    this.expect('{');
    const out: { [key: string]: Json } = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.readString();
      if (seen.has(key)) throw new JsonSyntaxError('duplicate key');
      seen.add(key);
      this.skipWhitespace();
      this.expect(':');
      this.skipWhitespace();
      const value = this.readValue(path === '' ? key : `${path}.${key}`);
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
      this.skipWhitespace();
      const next = this.text[this.index];
      if (next === ',') {
        this.index += 1;
        continue;
      }
      if (next === '}') {
        this.index += 1;
        return out;
      }
      throw new JsonSyntaxError('expected , or }');
    }
  }

  private readArray(path: string): Json {
    this.expect('[');
    const out: Json[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      out.push(this.readValue(`${path}[${out.length}]`));
      this.skipWhitespace();
      const next = this.text[this.index];
      if (next === ',') {
        this.index += 1;
        continue;
      }
      if (next === ']') {
        this.index += 1;
        return out;
      }
      throw new JsonSyntaxError('expected , or ]');
    }
  }

  private readString(): string {
    this.expect('"');
    let out = '';
    for (;;) {
      const ch = this.text[this.index];
      if (ch === undefined) throw new JsonSyntaxError('unterminated string');
      this.index += 1;
      if (ch === '"') return out;
      if (ch === '\\') {
        const esc = this.text[this.index];
        this.index += 1;
        switch (esc) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = this.text.slice(this.index, this.index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JsonSyntaxError('bad escape');
            out += String.fromCharCode(Number.parseInt(hex, 16));
            this.index += 4;
            break;
          }
          default:
            throw new JsonSyntaxError('bad escape');
        }
        continue;
      }
      if ((ch.charCodeAt(0) as number) < 0x20) throw new JsonSyntaxError('raw control character');
      out += ch;
    }
  }

  private readNumber(path: string): number {
    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index));
    if (!match || match[0] === '') throw new JsonSyntaxError('bad number');
    const literal = match[0];
    this.index += literal.length;
    const value = Number(literal);
    if (!Number.isFinite(value)) throw new JsonSyntaxError('bad number');
    this.numberLiterals.set(path, literal);
    return value;
  }
}

/** RFC 8785 JSON Canonicalization Scheme, for the values this app serialises. */
export function canonicalJson(value: Json): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return canonicalNumber(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort(compareCodeUnits);
  const parts = keys.map((key) => `${canonicalString(key)}:${canonicalJson(value[key] as Json)}`);
  return `{${parts.join(',')}}`;
}

function compareCodeUnits(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.charCodeAt(i) as number) - (b.charCodeAt(i) as number);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('non-finite number is not canonicalisable');
  if (value === 0) return '0';
  return String(value);
}

const escapes: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

function canonicalString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const escape = escapes[ch];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = ch.codePointAt(0) as number;
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return `${out}"`;
}
