// Reader for the pipeline file's YAML subset. The first line it cannot read ends reading with a single message.
import { formatProblem, UNREADABLE_LINE } from "./problems.ts";

export interface YamlScalar {
  readonly kind: "scalar";
  readonly line: number;
  readonly text: string;
  readonly value: string | number | boolean | null;
}

export interface YamlEntry {
  readonly key: string;
  readonly line: number;
  readonly value: YamlNode;
}

export interface YamlMap {
  readonly kind: "map";
  readonly line: number;
  readonly entries: readonly YamlEntry[];
}

interface YamlList {
  readonly kind: "list";
  readonly line: number;
  readonly items: readonly YamlNode[];
}

export type YamlNode = YamlScalar | YamlMap | YamlList;

type YamlResult =
  | { readonly ok: true; readonly root: YamlMap }
  | { readonly ok: false; readonly line: number; readonly message: string };

type Content =
  | { readonly kind: "pair"; readonly key: string; readonly value: string }
  | {
      readonly kind: "item";
      readonly restColumn: number;
      readonly rest: string;
      readonly pair: { readonly key: string; readonly value: string } | null;
    };

interface Row {
  readonly line: number;
  readonly indent: number;
  readonly text: string;
  readonly tab: boolean;
  content: Content | null;
}

class UnreadableLine extends Error {
  line: number;
  constructor(line: number) {
    super(unreadableMessage(line));
    this.line = line;
  }
}

function unreadableMessage(line: number): string {
  return formatProblem(line, UNREADABLE_LINE);
}

const INDICATORS = new Set(["&", "*", "{", "|", ">"]);

function isSpace(char: string): boolean {
  return char === " " || char === "\t";
}

function commentStart(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) === "#" && (i === 0 || isSpace(text.charAt(i - 1)))) return i;
  }
  return text.length;
}

function readQuoted(text: string, start: number, line: number): { value: string; end: number } {
  const quote = text.charAt(start);
  let value = "";
  for (let i = start + 1; i < text.length; i++) {
    const char = text.charAt(i);
    if (quote === "'") {
      if (char === "'") {
        if (text.charAt(i + 1) === "'") {
          value += "'";
          i++;
        } else {
          return { value, end: i + 1 };
        }
      } else {
        value += char;
      }
    } else if (char === "\\") {
      const next = text.charAt(i + 1);
      i++;
      if (next === "n") value += "\n";
      else if (next === "t") value += "\t";
      else value += next;
    } else if (char === '"') {
      return { value, end: i + 1 };
    } else {
      value += char;
    }
  }
  throw new UnreadableLine(line);
}

function endsLine(rest: string): boolean {
  const trimmed = rest.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function plainScalar(raw: string, line: number): YamlScalar {
  const text = raw.trim();
  if (text === "true") return { kind: "scalar", line, text, value: true };
  if (text === "false") return { kind: "scalar", line, text, value: false };
  if (text === "null") return { kind: "scalar", line, text: "", value: null };
  if (/^[+-]?\d+$/.test(text)) return { kind: "scalar", line, text, value: Number(text) };
  return { kind: "scalar", line, text, value: text };
}

function stringScalar(text: string, line: number): YamlScalar {
  return { kind: "scalar", line, text, value: text };
}

function parseFlowList(src: string, line: number): YamlList {
  const items: YamlNode[] = [];
  let i = 1;
  const skip = () => {
    while (i < src.length && isSpace(src.charAt(i))) i++;
  };
  skip();
  if (src.charAt(i) === "]") {
    i++;
  } else {
    for (;;) {
      skip();
      const char = src.charAt(i);
      if (char === "" || INDICATORS.has(char) || char === "[" || char === "," || char === "]") {
        throw new UnreadableLine(line);
      }
      if (char === '"' || char === "'") {
        const quoted = readQuoted(src, i, line);
        items.push(stringScalar(quoted.value, line));
        i = quoted.end;
      } else {
        let end = i;
        while (end < src.length && src.charAt(end) !== "," && src.charAt(end) !== "]") end++;
        items.push(plainScalar(src.slice(i, end), line));
        i = end;
      }
      skip();
      const next = src.charAt(i);
      if (next === ",") {
        i++;
        skip();
        if (src.charAt(i) === "]") {
          i++;
          break;
        }
      } else if (next === "]") {
        i++;
        break;
      } else {
        throw new UnreadableLine(line);
      }
    }
  }
  if (!endsLine(src.slice(i))) throw new UnreadableLine(line);
  return { kind: "list", line, items };
}

function parseValue(raw: string, line: number): YamlNode {
  const src = raw.trim();
  const first = src.charAt(0);
  if (INDICATORS.has(first)) throw new UnreadableLine(line);
  if (first === '"' || first === "'") {
    const quoted = readQuoted(src, 0, line);
    if (!endsLine(src.slice(quoted.end))) throw new UnreadableLine(line);
    return stringScalar(quoted.value, line);
  }
  if (first === "[") return parseFlowList(src, line);
  return plainScalar(src.slice(0, commentStart(src)), line);
}

function splitPair(text: string, line: number): { key: string; value: string } | null {
  const first = text.charAt(0);
  if (first === '"' || first === "'") {
    const quoted = readQuoted(text, 0, line);
    const match = /^\s*:(?:\s+(.*))?$/.exec(text.slice(quoted.end));
    return match ? { key: quoted.value, value: match[1] ?? "" } : null;
  }
  const limit = commentStart(text);
  for (let i = 0; i < limit; i++) {
    if (text.charAt(i) === ":" && (i + 1 === text.length || isSpace(text.charAt(i + 1)))) {
      const key = text.slice(0, i).trim();
      if (key === "" || INDICATORS.has(key.charAt(0)) || key.charAt(0) === "[") {
        throw new UnreadableLine(line);
      }
      return { key, value: text.slice(i + 1) };
    }
  }
  return null;
}

function classify(row: Row): Content {
  if (row.content) return row.content;
  if (row.tab) throw new UnreadableLine(row.line);
  let content: Content;
  if (row.text === "-" || row.text.startsWith("- ")) {
    const rest = row.text.slice(1).trimStart();
    if (endsLine(rest)) throw new UnreadableLine(row.line);
    const restColumn = row.indent + row.text.length - rest.length;
    content = { kind: "item", restColumn, rest, pair: splitPair(rest, row.line) };
  } else {
    const pair = splitPair(row.text, row.line);
    if (!pair) throw new UnreadableLine(row.line);
    content = { kind: "pair", key: pair.key, value: pair.value };
  }
  row.content = content;
  return content;
}

function toRows(source: string): Row[] {
  const rows: Row[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const body = raw.trimEnd();
    const text = body.trimStart();
    if (text === "" || text.startsWith("#")) return;
    const lead = body.slice(0, body.length - text.length);
    rows.push({ line: index + 1, indent: lead.length, text, tab: lead.includes("\t"), content: null });
  });
  return rows;
}

class BlockReader {
  private readonly rows: Row[];
  private pos = 0;

  constructor(rows: Row[]) {
    this.rows = rows;
  }

  readDocument(): YamlMap {
    const first = this.rows[0];
    if (!first) return { kind: "map", line: 1, entries: [] };
    if (classify(first).kind !== "pair") throw new UnreadableLine(first.line);
    const root = this.readMap(first.indent);
    const stray = this.rows[this.pos];
    if (stray) throw new UnreadableLine(stray.line);
    return root;
  }

  private readMap(indent: number): YamlMap {
    const entries: YamlEntry[] = [];
    const line = this.rows[this.pos]?.line ?? 1;
    for (let row = this.rows[this.pos]; row && row.indent >= indent; row = this.rows[this.pos]) {
      if (row.indent > indent) throw new UnreadableLine(row.line);
      const content = classify(row);
      if (content.kind !== "pair") throw new UnreadableLine(row.line);
      this.pos++;
      entries.push({ key: content.key, line: row.line, value: this.readPairValue(row, content.value) });
    }
    return { kind: "map", line, entries };
  }

  private readPairValue(row: Row, raw: string): YamlNode {
    if (!endsLine(raw)) return parseValue(raw, row.line);
    const next = this.rows[this.pos];
    if (!next || next.indent <= row.indent) return { kind: "scalar", line: row.line, text: "", value: null };
    return classify(next).kind === "item" ? this.readList(next.indent) : this.readMap(next.indent);
  }

  private readList(indent: number): YamlList {
    const items: YamlNode[] = [];
    const line = this.rows[this.pos]?.line ?? 1;
    for (let row = this.rows[this.pos]; row && row.indent >= indent; row = this.rows[this.pos]) {
      if (row.indent > indent) throw new UnreadableLine(row.line);
      const content = classify(row);
      if (content.kind !== "item") break;
      if (content.pair) {
        this.rows[this.pos] = {
          line: row.line,
          indent: content.restColumn,
          text: content.rest,
          tab: false,
          content: { kind: "pair", key: content.pair.key, value: content.pair.value },
        };
        items.push(this.readMap(content.restColumn));
      } else {
        this.pos++;
        items.push(parseValue(content.rest, row.line));
      }
    }
    return { kind: "list", line, items };
  }
}

export function readYaml(source: string): YamlResult {
  try {
    return { ok: true, root: new BlockReader(toRows(source)).readDocument() };
  } catch (error) {
    if (error instanceof UnreadableLine) return { ok: false, line: error.line, message: error.message };
    throw error;
  }
}
