export type YValue = string | number | boolean | null | YValue[] | YMap;
export type YMap = { [key: string]: YValue };

export class UnreadableLine extends Error {
  readonly line: number;

  constructor(line: number) {
    super(`can't read line ${line}`);
    this.line = line;
  }
}

export type Parsed = { value: YMap; lines: Map<string, number> };

type Row = { indent: number; text: string; line: number };

function unclosedQuote(text: string): boolean {
  let single = false;
  let double = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    else if (char === '#' && !single && !double) break;
  }
  return single || double;
}

function stripComment(text: string): string {
  let single = false;
  let double = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    else if (char === '#' && !single && !double) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text.trimEnd();
}

const keyOnly = /^[A-Za-z_.][A-Za-z0-9_.\-/]*:$/;
const keyValue = /^[A-Za-z_.][A-Za-z0-9_.\-/]*:\s+\S/;

function badValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('&') || trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('{')) return true;
  if (trimmed === '|' || trimmed === '>' || trimmed.startsWith('|') || trimmed.startsWith('>')) return true;
  return false;
}

function readRows(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;
    if (raw.trim() === '') continue;
    if (raw.trimStart().startsWith('#')) continue;
    if (/^\s*\t/.test(raw) || raw.startsWith('\t')) throw new UnreadableLine(line);
    if (unclosedQuote(raw)) throw new UnreadableLine(line);
    const body = stripComment(raw);
    if (body.trim() === '') continue;
    const indent = body.length - body.trimStart().length;
    const content = body.trim();
    const isItem = content === '-' || content.startsWith('- ');
    const inner = isItem ? content.replace(/^-\s*/, '') : content;
    if (isItem) {
      if (!(keyOnly.test(inner) || keyValue.test(inner) || inner.length > 0)) throw new UnreadableLine(line);
      if (keyValue.test(inner) && badValue(inner.slice(inner.indexOf(':') + 1))) throw new UnreadableLine(line);
      if (!keyOnly.test(inner) && !keyValue.test(inner) && badValue(inner)) throw new UnreadableLine(line);
    } else if (keyOnly.test(content)) {
      // a key with a nested block
    } else if (keyValue.test(content)) {
      if (badValue(content.slice(content.indexOf(':') + 1))) throw new UnreadableLine(line);
    } else {
      throw new UnreadableLine(line);
    }
    rows.push({ indent, text: content, line });
  }
  return rows;
}

function parseScalar(raw: string, line: number): YValue {
  const text = raw.trim();
  if (text === '') return null;
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new UnreadableLine(line);
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((part) => parseScalar(part, line));
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1);
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

export function parseYaml(text: string): Parsed {
  const rows = readRows(text);
  const lines = new Map<string, number>();
  let cursor = 0;

  const parseBlock = (indent: number, path: string): YValue => {
    if (cursor >= rows.length) return null;
    const first = rows[cursor];
    if (first.text === '-' || first.text.startsWith('- ')) return parseList(indent, path);
    return parseMap(indent, path);
  };

  const parseList = (indent: number, path: string): YValue[] => {
    const items: YValue[] = [];
    while (cursor < rows.length) {
      const row = rows[cursor];
      if (row.indent < indent) break;
      if (row.indent > indent) throw new UnreadableLine(row.line);
      if (!(row.text === '-' || row.text.startsWith('- '))) break;
      const inner = row.text.replace(/^-\s*/, '');
      const itemPath = `${path}[${items.length}]`;
      lines.set(itemPath, row.line);
      cursor += 1;
      if (inner === '') {
        items.push(parseBlock(indent + 2, itemPath));
        continue;
      }
      if (keyOnly.test(inner) || keyValue.test(inner)) {
        const key = inner.slice(0, inner.indexOf(':'));
        const rest = inner.slice(inner.indexOf(':') + 1).trim();
        const map: YMap = {};
        const keyPath = `${itemPath}.${key}`;
        lines.set(keyPath, row.line);
        const childIndent = row.indent + 2;
        if (rest === '') {
          map[key] = cursor < rows.length && rows[cursor].indent > row.indent ? parseBlock(rows[cursor].indent, keyPath) : null;
        } else {
          map[key] = parseScalar(rest, row.line);
        }
        while (cursor < rows.length && rows[cursor].indent >= childIndent && !(rows[cursor].text === '-' || rows[cursor].text.startsWith('- '))) {
          const extra = rows[cursor];
          if (!(keyOnly.test(extra.text) || keyValue.test(extra.text))) throw new UnreadableLine(extra.line);
          const extraKey = extra.text.slice(0, extra.text.indexOf(':'));
          const extraRest = extra.text.slice(extra.text.indexOf(':') + 1).trim();
          const extraPath = `${itemPath}.${extraKey}`;
          lines.set(extraPath, extra.line);
          cursor += 1;
          if (extraRest === '') {
            map[extraKey] =
              cursor < rows.length && rows[cursor].indent > extra.indent ? parseBlock(rows[cursor].indent, extraPath) : null;
          } else {
            map[extraKey] = parseScalar(extraRest, extra.line);
          }
        }
        items.push(map);
        continue;
      }
      items.push(parseScalar(inner, row.line));
    }
    return items;
  };

  const parseMap = (indent: number, path: string): YMap => {
    const map: YMap = {};
    while (cursor < rows.length) {
      const row = rows[cursor];
      if (row.indent < indent) break;
      if (row.indent > indent) throw new UnreadableLine(row.line);
      if (row.text === '-' || row.text.startsWith('- ')) break;
      if (!(keyOnly.test(row.text) || keyValue.test(row.text))) throw new UnreadableLine(row.line);
      const key = row.text.slice(0, row.text.indexOf(':'));
      const rest = row.text.slice(row.text.indexOf(':') + 1).trim();
      const keyPath = path === '' ? key : `${path}.${key}`;
      lines.set(keyPath, row.line);
      cursor += 1;
      if (rest === '') {
        if (cursor < rows.length && rows[cursor].indent > row.indent) {
          map[key] = parseBlock(rows[cursor].indent, keyPath);
        } else {
          map[key] = null;
        }
      } else {
        map[key] = parseScalar(rest, row.line);
      }
    }
    return map;
  };

  const value = cursor < rows.length ? parseMap(rows[0].indent, '') : {};
  if (cursor < rows.length) throw new UnreadableLine(rows[cursor].line);
  return { value, lines };
}

export function isMap(value: YValue): value is YMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asList(value: YValue): YValue[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function asString(value: YValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}
