import { OpError } from './bytes.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;

/** Parses JSON strictly, reporting the first unexpected character as a line and column. */
export function parseJson(text: string): JsonValue {
  let at = 0;

  const fail = (index: number): never => {
    let line = 1;
    let column = 1;
    for (let i = 0; i < index && i < text.length; i += 1) {
      if (text[i] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
    throw new OpError(`Invalid JSON at line ${line} column ${column}`);
  };

  const skipWhitespace = (): void => {
    while (at < text.length) {
      const ch = text[at]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') at += 1;
      else break;
    }
  };

  const expect = (ch: string): void => {
    if (text[at] !== ch) fail(at);
    at += 1;
  };

  const parseString = (): string => {
    expect('"');
    let out = '';
    for (;;) {
      if (at >= text.length) fail(at);
      const ch = text[at]!;
      if (ch === '"') {
        at += 1;
        return out;
      }
      if (ch === '\\') {
        at += 1;
        const esc = text[at];
        if (esc === undefined) fail(at);
        if (esc === '"') out += '"';
        else if (esc === '\\') out += '\\';
        else if (esc === '/') out += '/';
        else if (esc === 'b') out += '\b';
        else if (esc === 'f') out += '\f';
        else if (esc === 'n') out += '\n';
        else if (esc === 'r') out += '\r';
        else if (esc === 't') out += '\t';
        else if (esc === 'u') {
          const hex = text.slice(at + 1, at + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(at + 1);
          out += String.fromCharCode(Number.parseInt(hex, 16));
          at += 4;
        } else fail(at);
        at += 1;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) fail(at);
      out += ch;
      at += 1;
    }
  };

  const parseNumber = (): number => {
    const start = at;
    if (text[at] === '-') at += 1;
    if (text[at] === '0') at += 1;
    else if (text[at] !== undefined && text[at]! >= '1' && text[at]! <= '9') {
      while (at < text.length && text[at]! >= '0' && text[at]! <= '9') at += 1;
    } else fail(at);
    if (text[at] === '.') {
      at += 1;
      if (!(at < text.length && text[at]! >= '0' && text[at]! <= '9')) fail(at);
      while (at < text.length && text[at]! >= '0' && text[at]! <= '9') at += 1;
    }
    if (text[at] === 'e' || text[at] === 'E') {
      at += 1;
      if (text[at] === '+' || text[at] === '-') at += 1;
      if (!(at < text.length && text[at]! >= '0' && text[at]! <= '9')) fail(at);
      while (at < text.length && text[at]! >= '0' && text[at]! <= '9') at += 1;
    }
    return Number(text.slice(start, at));
  };

  const parseValue = (): JsonValue => {
    skipWhitespace();
    if (at >= text.length) fail(at);
    const ch = text[at]!;
    if (ch === '{') {
      at += 1;
      const map = new Map<string, JsonValue>();
      skipWhitespace();
      if (text[at] === '}') {
        at += 1;
        return map;
      }
      for (;;) {
        skipWhitespace();
        if (text[at] !== '"') fail(at);
        const key = parseString();
        skipWhitespace();
        expect(':');
        map.set(key, parseValue());
        skipWhitespace();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        expect('}');
        return map;
      }
    }
    if (ch === '[') {
      at += 1;
      const list: JsonValue[] = [];
      skipWhitespace();
      if (text[at] === ']') {
        at += 1;
        return list;
      }
      for (;;) {
        list.push(parseValue());
        skipWhitespace();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        expect(']');
        return list;
      }
    }
    if (ch === '"') return parseString();
    if (text.startsWith('true', at)) {
      at += 4;
      return true;
    }
    if (text.startsWith('false', at)) {
      at += 5;
      return false;
    }
    if (text.startsWith('null', at)) {
      at += 4;
      return null;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    return fail(at);
  };

  const value = parseValue();
  skipWhitespace();
  if (at !== text.length) fail(at);
  return value;
}

function writeScalar(value: null | boolean | number | string): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

/** Writes a parsed value back, keeping key order. An empty indent writes the minified form. */
export function writeJson(value: JsonValue, indent: string): string {
  const write = (node: JsonValue, depth: number): string => {
    const pad = indent === '' ? '' : '\n' + indent.repeat(depth + 1);
    const closePad = indent === '' ? '' : '\n' + indent.repeat(depth);
    if (Array.isArray(node)) {
      if (node.length === 0) return '[]';
      const items = node.map((item) => write(item, depth + 1));
      return `[${pad}${items.join(`,${pad}`)}${closePad}]`;
    }
    if (node instanceof Map) {
      if (node.size === 0) return '{}';
      const items: string[] = [];
      for (const [key, item] of node) {
        items.push(`${JSON.stringify(key)}:${indent === '' ? '' : ' '}${write(item, depth + 1)}`);
      }
      return `{${pad}${items.join(`,${pad}`)}${closePad}}`;
    }
    return writeScalar(node);
  };
  return write(value, 0);
}

/** Writes a value for one CSV field: strings raw, null empty, objects and arrays compact JSON. */
export function jsonFieldToCsvText(value: JsonValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return writeScalar(value);
  return writeJson(value, '');
}
