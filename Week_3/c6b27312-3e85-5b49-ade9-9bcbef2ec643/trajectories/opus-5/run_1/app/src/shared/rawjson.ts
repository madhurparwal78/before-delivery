/**
 * A JSON reader that keeps every scalar's source text, so house rule H1's number
 * grammar can be checked on the number's source text before the body is parsed
 * into numbers.
 */

export type RawNode =
  | { kind: 'object'; entries: { key: string; value: RawNode }[] }
  | { kind: 'array'; items: RawNode[] }
  | { kind: 'number'; raw: string }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' };

export class RawJsonError extends Error {}

export function parseRawJson(text: string): RawNode {
  let at = 0;

  function fail(message: string): never {
    throw new RawJsonError(`${message} at ${at}`);
  }

  function skipSpace(): void {
    while (at < text.length && (text[at] === ' ' || text[at] === '\t' || text[at] === '\n' || text[at] === '\r')) {
      at += 1;
    }
  }

  function readString(): string {
    if (text[at] !== '"') fail('expected string');
    at += 1;
    let out = '';
    while (at < text.length) {
      const character = text[at];
      if (character === '"') {
        at += 1;
        return out;
      }
      if (character === '\\') {
        at += 1;
        const escape = text[at];
        at += 1;
        switch (escape) {
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
            const hex = text.slice(at, at + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad escape');
            out += String.fromCharCode(parseInt(hex, 16));
            at += 4;
            break;
          }
          default:
            fail('bad escape');
        }
        continue;
      }
      const code = character.codePointAt(0)!;
      if (code <= 0x1f) fail('control character in string');
      out += character;
      at += 1;
    }
    return fail('unterminated string');
  }

  function readValue(): RawNode {
    skipSpace();
    const character = text[at];
    if (character === '{') {
      at += 1;
      const entries: { key: string; value: RawNode }[] = [];
      skipSpace();
      if (text[at] === '}') {
        at += 1;
        return { kind: 'object', entries };
      }
      for (;;) {
        skipSpace();
        const key = readString();
        skipSpace();
        if (text[at] !== ':') fail('expected colon');
        at += 1;
        entries.push({ key, value: readValue() });
        skipSpace();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        if (text[at] === '}') {
          at += 1;
          return { kind: 'object', entries };
        }
        fail('expected comma or close brace');
      }
    }
    if (character === '[') {
      at += 1;
      const items: RawNode[] = [];
      skipSpace();
      if (text[at] === ']') {
        at += 1;
        return { kind: 'array', items };
      }
      for (;;) {
        items.push(readValue());
        skipSpace();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        if (text[at] === ']') {
          at += 1;
          return { kind: 'array', items };
        }
        fail('expected comma or close bracket');
      }
    }
    if (character === '"') return { kind: 'string', value: readString() };
    if (text.startsWith('true', at)) {
      at += 4;
      return { kind: 'boolean', value: true };
    }
    if (text.startsWith('false', at)) {
      at += 5;
      return { kind: 'boolean', value: false };
    }
    if (text.startsWith('null', at)) {
      at += 4;
      return { kind: 'null' };
    }
    const match = /^-?(?:[0-9]+)?(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!match || match[0].length === 0) fail('unexpected token');
    const raw = match[0];
    at += raw.length;
    return { kind: 'number', raw };
  }

  const root = readValue();
  skipSpace();
  if (at !== text.length) fail('trailing content');
  return root;
}

export function rawToValue(node: RawNode): unknown {
  switch (node.kind) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const entry of node.entries) out[entry.key] = rawToValue(entry.value);
      return out;
    }
    case 'array':
      return node.items.map(rawToValue);
    case 'number':
      return Number(node.raw);
    case 'string':
      return node.value;
    case 'boolean':
      return node.value;
    case 'null':
      return null;
  }
}

export type RawLeaf = { path: string[]; node: RawNode };

/** Every scalar leaf of the body, in request-text order. */
export function rawLeaves(node: RawNode, path: string[] = []): RawLeaf[] {
  switch (node.kind) {
    case 'object':
      return node.entries.flatMap((entry) => rawLeaves(entry.value, [...path, entry.key]));
    case 'array':
      return node.items.flatMap((item, index) => rawLeaves(item, [...path, String(index)]));
    default:
      return [{ path, node }];
  }
}
