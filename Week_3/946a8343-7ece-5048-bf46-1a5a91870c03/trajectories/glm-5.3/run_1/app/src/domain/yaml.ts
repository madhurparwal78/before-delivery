// YAML subset parser for pipeline config files.
// Supports: block maps, block lists, flow lists of scalars, comments,
// plain/single/double quoted scalars, integers, true/false/null.
// Rejects: anchors, aliases, flow maps, multi-line scalars, tabs.

export interface YNode {
  kind: 'map' | 'list' | 'scalar';
  value: unknown;
  line: number;
}

export interface YScalar extends YNode {
  kind: 'scalar';
  value: string | number | boolean | null;
}

export interface YMap extends YNode {
  kind: 'map';
  value: Map<string, YNode>;
  keyLine: Map<string, number>;
}

export interface YList extends YNode {
  kind: 'list';
  value: YNode[];
  itemLine: number[];
}

export class YParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(message);
    this.line = line;
  }
}

interface LineInfo {
  text: string;
  indent: number;
  n: number;
}

const BAD_CHARS = /[&*{|>]/;

export function parseYaml(text: string): { value: unknown } | { error: YParseError } {
  const lines = text.split('\n');
  const infos: LineInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    if (stripped.includes('\t')) return { error: new YParseError(i + 1, "can't read this line") };
    const leading = stripped.match(/^[ ]*/);
    const indent = leading ? leading[0].length : 0;
    infos.push({ text: stripped.slice(indent), indent, n: i + 1 });
  }
  if (infos.length === 0) return { value: new YMapBuilder(0).build() };
  try {
    const p = new Parser(infos);
    const v = p.parseBlock(0, infos[0].indent, 0);
    if (p.pos < infos.length) {
      throw new YParseError(infos[p.pos].n, "can't read this line");
    }
    return { value: v };
  } catch (e) {
    if (e instanceof YParseError) return { error: e };
    throw e;
  }
}

function stripComment(line: string): string {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}

class YMapBuilder {
  private map = new Map<string, YNode>();
  private keyLines = new Map<string, number>();
  constructor(private line: number) {}
  set(k: string, v: YNode, line: number): void {
    this.map.set(k, v);
    this.keyLines.set(k, line);
  }
  build(): YMap {
    return {
      kind: 'map',
      value: this.map,
      keyLine: this.keyLines,
      line: this.line,
    };
  }
}

class Parser {
  pos = 0;
  depth = 0;

  constructor(private infos: LineInfo[]) {}

  private cur(): LineInfo | null {
    return this.pos < this.infos.length ? this.infos[this.pos] : null;
  }

  parseBlock(_start: number, indent: number, depth: number): YNode {
    if (depth > 40) throw new YParseError(this.cur()?.n ?? 1, "can't read this line");
    const first = this.cur();
    if (!first) throw new YParseError(1, "can't read this line");
    if (first.text.startsWith('- ') || first.text === '-') return this.parseList(indent, depth);
    return this.parseMap(indent, depth);
  }

  private parseList(indent: number, depth: number): YList {
    const items: YNode[] = [];
    const itemLine: number[] = [];
    while (true) {
      const c = this.cur();
      if (!c || c.indent < indent) break;
      if (c.indent > indent) throw new YParseError(c.n, "can't read this line");
      if (!(c.text === '-' || c.text.startsWith('- '))) break;
      itemLine.push(c.n);
      const rest = c.text === '-' ? '' : c.text.slice(2);
      if (rest.trim() === '') {
        this.pos++;
        const next = this.cur();
        if (next && next.indent > indent) {
          items.push(this.parseBlock(this.pos, next.indent, depth + 1));
        } else {
          items.push({ kind: 'scalar', value: null, line: c.n });
        }
      } else if (rest.includes(': ') || rest.endsWith(':')) {
        // inline map entry start: "- key: value" or "- key:"
        const m = matchKey(rest);
        if (!m) throw new YParseError(c.n, "can't read this line");
        const b = new YMapBuilder(c.n);
        const subIndent = indent + 2 + m.keyIndent;
        this.parseInlineMapEntry(b, m, rest, c.n, subIndent, depth);
        // continue with more entries at subIndent
        while (true) {
          const n = this.cur();
          if (!n || n.indent !== subIndent) break;
          if (n.text.startsWith('- ') || n.text === '-') break;
          const mm = matchKey(n.text);
          if (!mm) throw new YParseError(n.n, "can't read this line");
          this.parseInlineMapEntry(b, mm, n.text, n.n, subIndent, depth);
        }
        items.push(b.build());
      } else {
        const sc = parseScalar(rest, c.n);
        items.push(sc);
        this.pos++;
      }
    }
    return { kind: 'list', value: items, itemLine, line: this.infos[this.pos - 1]?.n ?? 1 };
  }

  private parseInlineMapEntry(b: YMapBuilder, m: { key: string; rest: string; keyIndent: number }, text: string, line: number, subIndent: number, depth: number): void {
    void text;
    if (m.rest.trim() === '') {
      this.pos++;
      const next = this.cur();
      if (next && next.indent > subIndent) {
        b.set(m.key, this.parseBlock(this.pos, next.indent, depth + 1), line);
      } else if (next && next.indent === subIndent && (next.text.startsWith('- ') || next.text === '-')) {
        b.set(m.key, this.parseList(subIndent, depth + 1), line);
      } else {
        b.set(m.key, { kind: 'scalar', value: null, line }, line);
      }
    } else {
      const v = parseScalar(m.rest, line);
      b.set(m.key, v, line);
      this.pos++;
    }
  }

  private parseMap(indent: number, depth: number): YMap {
    const b = new YMapBuilder(this.cur()?.n ?? 1);
    while (true) {
      const c = this.cur();
      if (!c || c.indent < indent) break;
      if (c.indent > indent) throw new YParseError(c.n, "can't read this line");
      if (c.text.startsWith('- ') || c.text === '-') break;
      const m = matchKey(c.text);
      if (!m) throw new YParseError(c.n, "can't read this line");
      const key = m.key;
      const rest = m.rest;
      if (rest.trim() === '') {
        this.pos++;
        const next = this.cur();
        if (next && next.indent > indent) {
          b.set(key, this.parseBlock(this.pos, next.indent, depth + 1), c.n);
        } else if (next && next.indent === indent && (next.text.startsWith('- ') || next.text === '-')) {
          b.set(key, this.parseList(indent, depth + 1), c.n);
        } else {
          b.set(key, { kind: 'scalar', value: null, line: c.n }, c.n);
        }
      } else if (rest.trim() === '[]') {
        b.set(key, { kind: 'list', value: [], itemLine: [], line: c.n } as YList, c.n);
        this.pos++;
      } else if (rest.trim() === '{}') {
        throw new YParseError(c.n, "can't read this line");
      } else if (rest.trim().startsWith('[')) {
        b.set(key, parseFlowList(rest.trim(), c.n), c.n);
        this.pos++;
      } else {
        b.set(key, parseScalar(rest, c.n), c.n);
        this.pos++;
      }
    }
    return b.build();
  }
}

function matchKey(text: string): { key: string; rest: string; keyIndent: number } | null {
  let i = 0;
  let key = '';
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = text[0];
    let j = 1;
    let buf = '';
    while (j < text.length) {
      if (text[j] === q) break;
      if (q === '"' && text[j] === '\\' && j + 1 < text.length) {
        buf += text[j + 1];
        j += 2;
        continue;
      }
      buf += text[j];
      j++;
    }
    if (j >= text.length) return null;
    key = buf;
    i = j + 1;
    if (text[i] !== ':') return null;
    if (text[i + 1] !== ' ' && text.length > i + 1) return null;
    return { key, rest: text.slice(i + 1).replace(/^ /, ''), keyIndent: 0 };
  }
  const idx = findColon(text);
  if (idx < 0) return null;
  key = text.slice(0, idx);
  if (key.trim() === '') return null;
  if (BAD_CHARS.test(key)) return null;
  const rest = text.slice(idx + 1);
  return { key: key.trim(), rest: rest.replace(/^ /, ''), keyIndent: 0 };
}

function findColon(text: string): number {
  let inS = false;
  let inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === ':' && !inS && !inD) {
      if (i + 1 >= text.length || text[i + 1] === ' ') return i;
    }
  }
  return -1;
}

export function parseScalar(text: string, line: number): YScalar {
  const t = text.trim();
  if (t === '') return { kind: 'scalar', value: null, line };
  if (t.startsWith('"')) {
    const m = t.match(/^"((?:[^"\\]|\\.)*)"/);
    if (!m) throw new YParseError(line, "can't read this line");
    return { kind: 'scalar', value: unescapeDouble(m[1]), line };
  }
  if (t.startsWith("'")) {
    const m = t.match(/^'((?:[^']|'')*)'/);
    if (!m) throw new YParseError(line, "can't read this line");
    return { kind: 'scalar', value: m[1].replace(/''/g, "'"), line };
  }
  if (BAD_CHARS.test(t)) throw new YParseError(line, "can't read this line");
  if (t === 'true') return { kind: 'scalar', value: true, line };
  if (t === 'false') return { kind: 'scalar', value: false, line };
  if (t === 'null' || t === '~') return { kind: 'scalar', value: null, line };
  if (/^-?\d+$/.test(t)) return { kind: 'scalar', value: parseInt(t, 10), line };
  return { kind: 'scalar', value: t, line };
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(.)/g, (_, ch) => {
    if (ch === 'n') return '\n';
    if (ch === 't') return '\t';
    return ch;
  });
}

function parseFlowList(text: string, line: number): YList {
  if (!text.startsWith('[') || !text.endsWith(']')) throw new YParseError(line, "can't read this line");
  const inner = text.slice(1, -1).trim();
  if (inner === '') return { kind: 'list', value: [], itemLine: [], line };
  const parts: string[] = [];
  let cur = '';
  let inS = false;
  let inD = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    if (c === ',' && !inS && !inD) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return { kind: 'list', value: parts.map((p) => parseScalar(p, line)), itemLine: parts.map(() => line), line };
}

// ---- JSON conversion ----

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function toJson(node: YNode | undefined): Json | undefined {
  if (!node) return undefined;
  if (node.kind === 'scalar') return (node as YScalar).value as Json;
  if (node.kind === 'list') return (node as YList).value.map((x) => toJson(x) ?? null);
  const out: { [k: string]: Json } = {};
  for (const [k, v] of (node as YMap).value.entries()) out[k] = toJson(v) ?? null;
  return out;
}

export function lineOf(node: YNode | undefined): number {
  return node?.line ?? 0;
}
