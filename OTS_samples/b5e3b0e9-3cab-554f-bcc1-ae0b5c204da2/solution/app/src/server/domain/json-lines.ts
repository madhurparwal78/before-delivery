/** A JSON parser that remembers the 1-based line of every key and value, for layout error lines. */

export type JsonNode =
  | { kind: "object"; line: number; members: JsonMember[] }
  | { kind: "array"; line: number; items: JsonNode[] }
  | { kind: "string"; line: number; value: string }
  | { kind: "number"; line: number; value: number }
  | { kind: "boolean"; line: number; value: boolean }
  | { kind: "null"; line: number };

export interface JsonMember {
  key: string;
  keyLine: number;
  value: JsonNode;
}

type JsonResult = { ok: true; root: JsonNode } | { ok: false; line: number };

const MAX_DEPTH = 100;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class SyntaxFault extends Error {
  readonly index: number;
  constructor(index: number) {
    super("syntax");
    this.index = index;
  }
}

export function parseJsonWithLines(text: string): JsonResult {
  const lineAt = (index: number): number => {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  };
  let at = 0;

  const skip = (): void => {
    while (at < text.length && " \t\n\r".includes(text.charAt(at))) at++;
  };

  const literal = (word: string, make: () => JsonNode): JsonNode => {
    if (!text.startsWith(word, at)) throw new SyntaxFault(at);
    const node = make();
    at += word.length;
    return node;
  };

  const string = (): string => {
    at++;
    let value = "";
    for (;;) {
      if (at >= text.length) throw new SyntaxFault(at);
      const ch = text.charAt(at);
      if (ch === '"') {
        at++;
        return value;
      }
      if (ch.charCodeAt(0) < 0x20) throw new SyntaxFault(at);
      if (ch === "\\") {
        const next = text.charAt(at + 1);
        const simple: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (next in simple) {
          value += simple[next];
          at += 2;
        } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) {
          value += String.fromCharCode(parseInt(text.slice(at + 2, at + 6), 16));
          at += 6;
        } else throw new SyntaxFault(at);
      } else {
        value += ch;
        at++;
      }
    }
  };

  const value = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) throw new SyntaxFault(at);
    skip();
    const line = lineAt(at);
    const ch = text.charAt(at);
    if (ch === "{") {
      at++;
      const members: JsonMember[] = [];
      skip();
      if (text.charAt(at) === "}") {
        at++;
        return { kind: "object", line, members };
      }
      for (;;) {
        skip();
        if (text.charAt(at) !== '"') throw new SyntaxFault(at);
        const keyLine = lineAt(at);
        const key = string();
        skip();
        if (text.charAt(at) !== ":") throw new SyntaxFault(at);
        at++;
        members.push({ key, keyLine, value: value(depth + 1) });
        skip();
        const sep = text.charAt(at);
        if (sep === ",") at++;
        else if (sep === "}") {
          at++;
          return { kind: "object", line, members };
        } else throw new SyntaxFault(at);
      }
    }
    if (ch === "[") {
      at++;
      const items: JsonNode[] = [];
      skip();
      if (text.charAt(at) === "]") {
        at++;
        return { kind: "array", line, items };
      }
      for (;;) {
        items.push(value(depth + 1));
        skip();
        const sep = text.charAt(at);
        if (sep === ",") at++;
        else if (sep === "]") {
          at++;
          return { kind: "array", line, items };
        } else throw new SyntaxFault(at);
      }
    }
    if (ch === '"') return { kind: "string", line, value: string() };
    if (ch === "t") return literal("true", () => ({ kind: "boolean", line, value: true }));
    if (ch === "f") return literal("false", () => ({ kind: "boolean", line, value: false }));
    if (ch === "n") return literal("null", () => ({ kind: "null", line }));
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (!match) throw new SyntaxFault(at);
    at += match[0].length;
    return { kind: "number", line, value: Number(match[0]) };
  };

  try {
    const root = value(0);
    skip();
    if (at < text.length) throw new SyntaxFault(at);
    return { ok: true, root };
  } catch (fault) {
    if (fault instanceof SyntaxFault) return { ok: false, line: lineAt(fault.index) };
    throw fault;
  }
}

export const member = (node: JsonNode, key: string): JsonMember | undefined =>
  node.kind === "object" ? node.members.find((m) => m.key === key) : undefined;
